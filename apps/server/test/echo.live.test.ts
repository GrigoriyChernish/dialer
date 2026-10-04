import {
  AudioFrame,
  AudioSource,
  AudioStream,
  LocalAudioTrack,
  LocalVideoTrack,
  Room,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
  VideoBufferType,
  VideoFrame,
  VideoSource,
  VideoStream,
  type RemoteTrack,
} from '@livekit/rtc-node';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { runEcho, SAMPLE_RATE } from '../src/bots/echo';
import { signAccessToken } from '../src/livekit';

/**
 * Ехо Олени на справжньому LiveKit: `LIVEKIT_TEST_URL=ws://localhost:7880 LIVEKIT_TEST_KEY=devkey LIVEKIT_TEST_SECRET=secret pnpm test`
 * (локальний сервер: `docker run --rm -p 7880:7880 -p 7881:7881 -p 7882:7882/udp livekit/livekit-server --dev --bind 0.0.0.0`).
 * Без змінних тест пропускається.
 */
const url = process.env.LIVEKIT_TEST_URL;
const cfg = { apiKey: process.env.LIVEKIT_TEST_KEY ?? '', apiSecret: process.env.LIVEKIT_TEST_SECRET ?? '' };

const W = 320;
const H = 180;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Чекає, поки `fn` поверне правду, не довше `ms`. */
async function until(fn: () => boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (!fn()) {
    if (Date.now() > end) throw new Error('не дочекались умови');
    await sleep(50);
  }
}

describe.skipIf(!url)('ехо-бот на справжньому LiveKit', () => {
  const room = `echo-test-${Date.now()}`;
  const access = (identity: string) => ({ url: url!, token: signAccessToken(cfg, { room, identity, name: identity }) });

  async function join() {
    const caller = new Room();
    const echoed = { audioPeak: 0, videoFrames: 0, videoPublished: 0, videoUnpublished: 0 };
    const tracks = new Map<string, RemoteTrack>();
    caller.on(RoomEvent.TrackSubscribed, (track, _pub, p) => {
      if (p.identity !== 'bot:olena:bot') return;
      tracks.set(track.sid ?? '', track);
      if (track.kind === TrackKind.KIND_AUDIO) {
        void (async () => {
          try {
            for await (const frame of new AudioStream(track, SAMPLE_RATE, 1)) {
              for (const v of frame.data) echoed.audioPeak = Math.max(echoed.audioPeak, Math.abs(v));
            }
          } catch {}
        })();
      } else {
        echoed.videoPublished++;
        void (async () => {
          try {
            for await (const _ of new VideoStream(track)) echoed.videoFrames++;
          } catch {}
        })();
      }
    });
    caller.on(RoomEvent.TrackUnsubscribed, track => {
      if (track.kind === TrackKind.KIND_VIDEO) echoed.videoUnpublished++;
    });
    const { url: u, token } = access('caller');
    await caller.connect(u, token, { autoSubscribe: true, dynacast: false });
    return { caller, echoed };
  }

  /** Звук 440 Гц і зелений кадр, як від справжньої камери й мікрофона. */
  function feed(caller: Room) {
    const audio = new AudioSource(SAMPLE_RATE, 1);
    const video = new VideoSource(W, H);
    const sample = SAMPLE_RATE / 100; // 10 мс
    let n = 0;
    let stop = false;
    const rgba = new Uint8Array(W * H * 4);
    for (let i = 0; i < rgba.length; i += 4) rgba.set([0, 200, 0, 255], i);
    void (async () => {
      while (!stop) {
        const pcm = new Int16Array(sample);
        for (let i = 0; i < sample; i++) pcm[i] = Math.round(8000 * Math.sin((2 * Math.PI * 440 * n++) / SAMPLE_RATE));
        await audio.captureFrame(new AudioFrame(pcm, SAMPLE_RATE, 1, sample)).catch(() => {});
      }
    })();
    const timer = setInterval(() => video.captureFrame(new VideoFrame(rgba, W, H, VideoBufferType.RGBA)), 66);
    const audioTrack = LocalAudioTrack.createAudioTrack('mic', audio);
    const videoTrack = LocalVideoTrack.createVideoTrack('cam', video);
    return {
      publishAudio: () =>
        caller.localParticipant!.publishTrack(audioTrack, new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE })),
      publishVideo: () =>
        caller.localParticipant!.publishTrack(videoTrack, new TrackPublishOptions({ source: TrackSource.SOURCE_CAMERA })),
      stop: () => {
        stop = true;
        clearInterval(timer);
      },
    };
  }

  it('повертає звук і відео співрозмовника, а зняту камеру прибирає', async () => {
    const stopBot = await runEcho(access('bot:olena:bot'), pino({ level: 'silent' }));
    const { caller, echoed } = await join();
    const media = feed(caller);
    try {
      await media.publishAudio();
      const camera = await media.publishVideo();

      await until(() => echoed.audioPeak > 1000); // звук повернувся, не тиша
      await until(() => echoed.videoFrames > 5); // кадри повернулись
      expect(echoed.videoPublished).toBe(1);

      // камеру зняли: відео Олени зникає
      await caller.localParticipant!.unpublishTrack(camera.sid!);
      await until(() => echoed.videoUnpublished === 1);
    } finally {
      media.stop();
      await caller.disconnect();
      await stopBot();
    }
  }, 30_000);
});
