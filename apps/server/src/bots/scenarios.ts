import type { BotMediaKind } from './media';

/** Поведінка демо-співрозмовників (docs/demo.md): відповідає й повертає ехо (Олена), відповідає й грає відео (Відео-тест), не відповідає (Андрій), зайнято (Support). */
export type BotScenario =
  { kind: 'answer'; delayMs: number; media?: BotMediaKind } | { kind: 'busy' } | { kind: 'ignore'; timeoutMs: number };

const SCENARIOS: Record<string, BotScenario> = {
  'bot:olena': { kind: 'answer', delayMs: 3500, media: 'echo' },
  'bot:video': { kind: 'answer', delayMs: 2000, media: 'play' },
  'bot:andriy': { kind: 'ignore', timeoutMs: 8000 },
  'bot:support': { kind: 'busy' },
};

export const botScenario = (userId: string): BotScenario => SCENARIOS[userId] ?? { kind: 'ignore', timeoutMs: 8000 };
