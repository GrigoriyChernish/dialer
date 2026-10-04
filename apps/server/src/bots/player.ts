import type { LiveKitAccess } from '@dialer/shared';
import {
  AudioFrame,
  AudioSource,
  LocalAudioTrack,
  LocalVideoTrack,
  Room,
  TrackPublishOptions,
  TrackSource,
  VideoBufferType,
  VideoFrame,
  VideoSource,
} from '@livekit/rtc-node';
import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import type { Logger } from '../logger';
import { SAMPLE_RATE } from './echo';

/** Що грає відео-бот: файл (у циклі) або, без файлу, тестова картинка й тон. */
export interface PlayerConfig {
  file: string | null;
  /** Висота кадру, пікселі (2160: 4K); ширина 16:9, непропорційне відео вписується з чорними смугами. */
  height: number;
}

const FPS = 30;
const AUDIO_CHUNK = SAMPLE_RATE / 50; // 20 мс

/** Бот-плеєр: ffmpeg розкодовує файл у сирі кадри й звук, бот публікує їх у кімнату. */
export async function runPlayer(access: LiveKitAccess, log: Logger, cfg: PlayerConfig): Promise<() => Promise<void>> {
  const h = cfg.height % 2 === 0 ? cfg.height : cfg.height + 1;
  const w = Math.round((h * 16) / 9 / 2) * 2;
  const source = cfg.file
    ? ['-re', '-stream_loop', '-1', '-i', cfg.file]
    : [
        '-re',
        '-f',
        'lavfi',
        '-i',
        `testsrc2=size=${w}x${h}:rate=${FPS}`,
        '-f',
        'lavfi',
        '-i',
        `sine=frequency=440:sample_rate=${SAMPLE_RATE}`,
      ];
  const scale = `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,fps=${FPS}`;
  const ffmpeg = spawn(
    'ffmpeg',
    [
      '-loglevel',
      'error',
      ...source,
      '-map',
      cfg.file ? '0:v:0' : '0:v',
      '-vf',
      scale,
      '-pix_fmt',
      'yuv420p',
      '-f',
      'rawvideo',
      'pipe:1',
      '-map',
      cfg.file ? '0:a:0?' : '1:a',
      '-ar',
      String(SAMPLE_RATE),
      '-ac',
      '1',
      '-f',
      's16le',
      'pipe:3',
    ],
    { stdio: ['ignore', 'pipe', 'pipe', 'pipe'] },
  );
  ffmpeg.on('error', err => log.warn({ err }, 'ffmpeg не запустився (чи встановлено ffmpeg?)'));
  ffmpeg.stderr?.on('data', d => log.warn({ ffmpeg: String(d).trim() }, 'ffmpeg'));

  const room = new Room();
  const video = new VideoSource(w, h);
  const audio = new AudioSource(SAMPLE_RATE, 1);
  await room.connect(access.url, access.token, { autoSubscribe: false, dynacast: false });
  const me = room.localParticipant!;
  await me.publishTrack(
    LocalVideoTrack.createVideoTrack('player-video', video),
    new TrackPublishOptions({ source: TrackSource.SOURCE_CAMERA }),
  );
  await me.publishTrack(
    LocalAudioTrack.createAudioTrack('player-audio', audio),
    new TrackPublishOptions({ source: TrackSource.SOURCE_MICROPHONE }),
  );
  log.info({ file: cfg.file, w, h }, 'відео-бот у кімнаті');

  /** Ріже потік ffmpeg на шматки однакового розміру. */
  const chunks = (stream: Readable | null, size: number, onChunk: (c: Buffer) => void) => {
    let rest: Buffer = Buffer.alloc(0);
    stream?.on('data', (d: Buffer) => {
      rest = rest.length ? Buffer.concat([rest, d]) : d;
      while (rest.length >= size) {
        onChunk(rest.subarray(0, size));
        rest = rest.subarray(size);
      }
    });
  };
  chunks(ffmpeg.stdout, (w * h * 3) / 2, c =>
    video.captureFrame(new VideoFrame(new Uint8Array(c), w, h, VideoBufferType.I420)),
  );
  chunks(ffmpeg.stdio[3] as Readable | null, AUDIO_CHUNK * 2, c => {
    const samples = new Int16Array(AUDIO_CHUNK);
    for (let i = 0; i < AUDIO_CHUNK; i++) samples[i] = c.readInt16LE(i * 2);
    void audio.captureFrame(new AudioFrame(samples, SAMPLE_RATE, 1, AUDIO_CHUNK)).catch(() => {});
  });

  return async () => {
    ffmpeg.kill('SIGKILL');
    await room.disconnect();
  };
}
