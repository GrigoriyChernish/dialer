/** Поведінка демо-співрозмовників (docs/demo.md): відповідає (Олена), не відповідає (Андрій), зайнято (Support). */
export type BotScenario =
  { kind: 'answer'; delayMs: number } | { kind: 'busy' } | { kind: 'ignore'; timeoutMs: number };

const SCENARIOS: Record<string, BotScenario> = {
  'bot:olena': { kind: 'answer', delayMs: 3500 },
  'bot:andriy': { kind: 'ignore', timeoutMs: 8000 },
  'bot:support': { kind: 'busy' },
};

export const botScenario = (userId: string): BotScenario => SCENARIOS[userId] ?? { kind: 'ignore', timeoutMs: 8000 };
