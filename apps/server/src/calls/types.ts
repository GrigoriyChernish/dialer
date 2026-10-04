import type { ServerMessage } from '@dialer/shared';

/** Дзвінок на сервері. Джерело правди про стан (docs/signaling.md). */
export interface Call {
  id: string;
  siteId: string;
  callerId: string;
  calleeId: string;
  /** Пристрій, з якого подзвонили. */
  callerDevice: string;
  /** Пристрій адресата, що прийняв дзвінок. */
  answeredDevice?: string;
  video: boolean;
  state: 'ringing' | 'connected' | 'ended';
  createdAt: number;
  /** Коли закінчується очікування відповіді. */
  expiresAt: number;
  answeredAt?: number;
  holdCaller: boolean;
  holdCallee: boolean;
  endedAt?: number;
  reason?: string;
}

/** Хто виконує команду: користувач і його пристрій. */
export interface Actor {
  siteId: string;
  userId: string;
  deviceId: string;
}

/** Повідомлення, яке треба доставити користувачеві (усім пристроям чи окремим). */
export interface Effect {
  siteId: string;
  userId: string;
  /** Лише цей пристрій. */
  deviceId?: string;
  /** Усі пристрої, крім цього. */
  exceptDeviceId?: string;
  msg: ServerMessage;
}

export interface Clock {
  now(): number;
  /** Запускає таймер; повертає функцію скасування. */
  after(ms: number, fn: () => void): () => void;
}

export const realClock: Clock = {
  now: () => Date.now(),
  after(ms, fn) {
    const t = setTimeout(fn, ms);
    t.unref();
    return () => clearTimeout(t);
  },
};
