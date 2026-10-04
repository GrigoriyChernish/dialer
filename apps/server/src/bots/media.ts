import type { LiveKitAccess } from '@dialer/shared';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import type { Logger } from '../logger';
import { runEcho } from './echo';
import { runPlayer, type PlayerConfig } from './player';

/** Що бот робить у кімнаті: повертає звук і відео співрозмовника або грає відео. */
export type BotMediaKind = 'echo' | 'play';

/** Медіа демо-ботів: вони заходять у кімнату LiveKit на час дзвінка (docs/demo.md). */
export interface BotMedia {
  start(callId: string, access: LiveKitAccess, kind: BotMediaKind): Promise<void>;
  /** Виходить із кімнати дзвінка; без запущеного бота нічого не робить. */
  stop(callId: string): Promise<void>;
}

/** Справжні боти на `@livekit/rtc-node`. Тести підставляють підміну з тим самим інтерфейсом. */
export function createBotMedia(logger: Logger, player: PlayerConfig): BotMedia {
  const log = logger.child({ module: 'bot-media' });
  const running = new Map<string, Promise<() => Promise<void>>>();

  // Поки є боти, раз на 10 с пишемо пам'ять і найдовшу затримку циклу подій: нативна частина LiveKit великою тримає
  // слабку машину Fly.io (256 МБ) близько до OOM, і за цими рядками видно, що росте перед завісанням.
  let probe: ReturnType<typeof setInterval> | undefined;
  const lag = monitorEventLoopDelay({ resolution: 20 });
  const watch = () => {
    if (running.size > 0 && !probe) {
      lag.enable();
      probe = setInterval(() => {
        const m = process.memoryUsage();
        const mb = (n: number) => Math.round(n / 1048576);
        const lagMs = Math.round(lag.max / 1e6);
        lag.reset();
        const stats = {
          bots: running.size,
          rssMb: mb(m.rss),
          heapMb: mb(m.heapUsed),
          externalMb: mb(m.external),
          lagMs,
        };
        if (lagMs > 500) log.warn(stats, 'цикл подій відстає');
        else log.info(stats, 'ресурси ботів');
      }, 10_000);
      probe.unref();
    } else if (running.size === 0 && probe) {
      clearInterval(probe);
      probe = undefined;
      lag.disable();
    }
  };
  return {
    async start(callId, access, kind) {
      const l = log.child({ callId });
      const run = kind === 'echo' ? runEcho(access, l) : runPlayer(access, l, player);
      running.set(callId, run);
      watch();
      try {
        await run;
      } catch (err) {
        running.delete(callId);
        watch();
        throw err;
      }
    },
    async stop(callId) {
      const run = running.get(callId);
      running.delete(callId);
      watch();
      if (!run) return;
      const stop = await run.catch(() => null);
      await stop?.().catch(() => {});
    },
  };
}
