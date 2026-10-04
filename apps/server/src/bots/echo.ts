import type { LiveKitAccess } from '@dialer/shared';
import {
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  LocalVideoTrack,
  Room,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
  VideoSource,
  VideoStream,
  type LocalTrackPublication,
  type RemoteTrack,
} from '@livekit/rtc-node';
import type { Logger } from '../logger';

export const SAMPLE_RATE = 48000;

/** Стеля відео-ехо: бот кодує відео на самому сервері, а там одне спільне ядро. */
const ECHO_VIDEO_BITRATE = 600_000n;
const ECHO_VIDEO_FPS = 20;

/** Читає потік до кінця й віддає кожен елемент; помилка чи закриття потоку просто завершують цикл. */
export async function pump<T>(stream: ReadableStream<T>, onItem: (item: T) => void | Promise<void>) {
  const reader = stream.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      await onItem(value);
    }
  } catch {
    // трек відписано або кімнату закрито
  } finally {
    reader.releaseLock();
  }
}

/** Ехо-бот (Олена): заходить у кімнату й повертає співрозмовнику його ж звук і відео. Ехо одного дзвінка: чужі треки перепублікуються з тими самими кадрами. */
export async function runEcho(access: LiveKitAccess, log: Logger): Promise<() => Promise<void>> {
  const room = new Room();
  const audio = new AudioSource(SAMPLE_RATE, 1);
  const audioTrack = LocalAudioTrack.createAudioTrack('echo-audio', audio);
  let video: { source: VideoSource; track: LocalVideoTrack; pub: LocalTrackPublication; w: number; h: number } | null =
    null;
  /** Збільшується при кожному знятті відео: публікація, що завершилась після цього, застаріла й одразу знімається. */
  let videoEpoch = 0;
  const stops = new Map<string, () => void>();
  /** Треки співрозмовника, які він зараз вимкнув (камера чи мікрофон): їхні кадри не повертаємо. */
  const muted = new Set<string>();

  const unpublishPub = (pub: LocalTrackPublication) =>
    pub.sid ? room.localParticipant?.unpublishTrack(pub.sid).catch(() => {}) : undefined;
  const publishVideo = async (w: number, h: number) => {
    const epoch = videoEpoch;
    const source = new VideoSource(w, h);
    const track = LocalVideoTrack.createVideoTrack('echo-video', source);
    // одна копія замість трьох шарів simulcast і потолок бітрейту та частоти кадрів: програмне кодування на одному ядрі Fly.io
    // інакше забиває процесор і сервер перестає відповідати (в логах немає записів, health check падає)
    const pub = await room.localParticipant!.publishTrack(
      track,
      new TrackPublishOptions({
        source: TrackSource.SOURCE_CAMERA,
        simulcast: false,
        videoEncoding: { maxBitrate: ECHO_VIDEO_BITRATE, maxFramerate: ECHO_VIDEO_FPS },
      }),
    );
    // поки публікували, відео зняли (камеру вимкнули чи трек відписано)
    if (epoch !== videoEpoch) return void (await unpublishPub(pub));
    video = { source, track, pub, w, h };
  };
  const unpublishVideo = async () => {
    const v = video;
    video = null;
    videoEpoch++;
    if (v) await unpublishPub(v.pub);
  };

  const echoTrack = (track: RemoteTrack) => {
    const sid = track.sid ?? '';
    let live = true;
    stops.set(sid, () => (live = false));
    if (track.kind === TrackKind.KIND_AUDIO) {
      void pump(new AudioStream(track, SAMPLE_RATE, 1), frame =>
        live && !muted.has(sid) ? audio.captureFrame(frame) : undefined,
      );
    } else if (track.kind === TrackKind.KIND_VIDEO) {
      let busy = false;
      void pump(new VideoStream(track), async ({ frame, timestampUs, rotation }) => {
        if (!live || busy || muted.has(sid)) return;
        busy = true;
        try {
          // розмір кадру змінився (адаптивна якість): публікуємо відео наново з новим джерелом
          if (video && (video.w !== frame.width || video.h !== frame.height)) await unpublishVideo();
          if (!video) await publishVideo(frame.width, frame.height);
          video?.source.captureFrame(frame, timestampUs, rotation);
        } finally {
          busy = false;
        }
      });
    }
  };

  room.on(RoomEvent.TrackSubscribed, track => echoTrack(track));
  room.on(RoomEvent.TrackUnsubscribed, track => {
    const sid = track.sid ?? '';
    stops.get(sid)?.();
    stops.delete(sid);
    muted.delete(sid);
    if (track.kind === TrackKind.KIND_VIDEO) void unpublishVideo();
  });
  // камеру вимкнули: трек лишається, кадри припиняються (чи йдуть чорні); знімаємо своє відео, а при ввімкненні воно з'явиться з першим кадром
  room.on(RoomEvent.TrackMuted, (pub, participant) => {
    if (participant === room.localParticipant || !pub.sid) return;
    muted.add(pub.sid);
    if (pub.kind === TrackKind.KIND_VIDEO) void unpublishVideo();
  });
  room.on(RoomEvent.TrackUnmuted, (pub, participant) => {
    if (participant !== room.localParticipant && pub.sid) muted.delete(pub.sid);
  });

  await room.connect(access.url, access.token, { autoSubscribe: true, dynacast: false });
  await room.localParticipant!.publishTrack(
    audioTrack,
    new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }),
  );
  log.info('ехо-бот у кімнаті');
  return async () => {
    for (const stop of stops.values()) stop();
    await room.disconnect();
  };
}
