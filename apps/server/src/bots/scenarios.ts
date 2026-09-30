/** Поведінка демо-співрозмовників (docs/demo.md): відповідає, зайнято, не відповідає. */
export type BotScenario =
  | { kind: 'answer'; delayMs: number }
  | { kind: 'busy' }
  | { kind: 'ignore'; timeoutMs: number };

const SCENARIOS: Record<string, BotScenario> = {
  'bot:olena': { kind: 'answer', delayMs: 3500 },
  'bot:andriy': { kind: 'busy' },
  'bot:support': { kind: 'ignore', timeoutMs: 8000 },
};

export const botScenario = (userId: string): BotScenario =>
  SCENARIOS[userId] ?? { kind: 'ignore', timeoutMs: 8000 };
