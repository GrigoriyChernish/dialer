import type { LiveKitAccess } from '@dialer/shared';
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
  return {
    async start(callId, access, kind) {
      const l = log.child({ callId });
      const run = kind === 'echo' ? runEcho(access, l) : runPlayer(access, l, player);
      running.set(callId, run);
      try {
        await run;
      } catch (err) {
        running.delete(callId);
        throw err;
      }
    },
    async stop(callId) {
      const run = running.get(callId);
      running.delete(callId);
      if (!run) return;
      const stop = await run.catch(() => null);
      await stop?.().catch(() => {});
    },
  };
}
