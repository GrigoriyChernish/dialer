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
  const stops = new Map<string, () => void>();

  const publishVideo = async (w: number, h: number) => {
    const source = new VideoSource(w, h);
    const track = LocalVideoTrack.createVideoTrack('echo-video', source);
    const pub = await room.localParticipant!.publishTrack(
      track,
      new TrackPublishOptions({ source: TrackSource.SOURCE_CAMERA }),
    );
    video = { source, track, pub, w, h };
  };
  const unpublishVideo = async () => {
    const v = video;
    video = null;
    if (v?.pub.sid) await room.localParticipant?.unpublishTrack(v.pub.sid).catch(() => {});
  };

  const echoTrack = (track: RemoteTrack) => {
    let live = true;
    stops.set(track.sid ?? '', () => (live = false));
    if (track.kind === TrackKind.KIND_AUDIO) {
      void pump(new AudioStream(track, SAMPLE_RATE, 1), frame => (live ? audio.captureFrame(frame) : undefined));
    } else if (track.kind === TrackKind.KIND_VIDEO) {
      let busy = false;
      void pump(new VideoStream(track), async ({ frame, timestampUs, rotation }) => {
        if (!live || busy) return;
        busy = true;
        try {
          // розмір кадру змінився (адаптивна якість): публікуємо відео наново з новим джерелом
          if (video && (video.w !== frame.width || video.h !== frame.height)) await unpublishVideo();
          if (!video) await publishVideo(frame.width, frame.height);
          video!.source.captureFrame(frame, timestampUs, rotation);
        } finally {
          busy = false;
        }
      });
    }
  };

  room.on(RoomEvent.TrackSubscribed, track => echoTrack(track));
  room.on(RoomEvent.TrackUnsubscribed, track => {
    stops.get(track.sid ?? '')?.();
    stops.delete(track.sid ?? '');
    if (track.kind === TrackKind.KIND_VIDEO) void unpublishVideo();
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
