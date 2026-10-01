export type SoundKind = 'ringback' | 'busy' | 'ringtone' | 'hold' | 'waiting';

let ctx: AudioContext | undefined;
const audio = () => {
  ctx ??= new AudioContext();
  void ctx.resume();
  return ctx;
};

function note(f: number, t: number, d: number, type: OscillatorType, v: number) {
  const c = audio();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = f;
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(v, t + 0.02);
  g.gain.linearRampToValueAtTime(0, t + d);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + d + 0.05);
}

function loop(period: number, fn: () => void) {
  fn();
  const i = setInterval(fn, period * 1000);
  return () => clearInterval(i);
}

const MAKE: Record<SoundKind, () => () => void> = {
  ringback: () => loop(4, () => note(425, audio().currentTime, 1, 'sine', 0.18)),
  busy: () => loop(0.7, () => note(425, audio().currentTime, 0.35, 'sine', 0.18)),
  ringtone: () =>
    loop(2.2, () => {
      const t = audio().currentTime;
      [659, 523, 659, 784].forEach((f, i) => note(f, t + i * 0.18, 0.16, 'triangle', 0.2));
    }),
  // другий вхідний під час розмови: два тихі короткі сигнали, щоб не заглушати співрозмовника
  waiting: () =>
    loop(3, () => {
      const t = audio().currentTime;
      [0, 0.3].forEach(d => note(440, t + d, 0.15, 'sine', 0.1));
    }),
  hold: () =>
    loop(2, () => {
      const t = audio().currentTime;
      [392, 494, 587, 494].forEach((f, i) => note(f, t + i * 0.5, 0.45, 'sine', 0.12));
    }),
};

/** Сигнали гудків і мелодій (Web Audio). iOS вмикає звук лише з жесту: контекст розблоковуємо на першому дотику. */
export class Sounds {
  enabled = true;
  private stopFn?: () => void;
  private timer?: ReturnType<typeof setTimeout>;

  constructor() {
    addEventListener('pointerdown', () => audio(), { once: true });
  }

  play(kind: SoundKind | null, ms?: number) {
    this.stop();
    if (!kind || !this.enabled) return;
    this.stopFn = MAKE[kind]();
    if (ms) this.timer = setTimeout(() => this.stop(), ms);
  }

  stop() {
    clearTimeout(this.timer);
    this.stopFn?.();
    this.stopFn = undefined;
  }
}
