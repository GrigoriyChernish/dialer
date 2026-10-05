import type { ServerMessage } from '@dialer/shared';
import { PING_INTERVAL_MS, PROTOCOL_VERSION } from '@dialer/shared';

// паузи між спробами: перезапуск сервера на Fly.io триває ~10 с, тож довше 5 с не чекаємо
const BACKOFF_S = [1, 1, 2, 3, 5];
/** Сервер закрив з'єднання: токен недійсний. Нового токена чекаємо від сайту-господаря. */
const CLOSE_UNAUTHORIZED = 4401;
const FATAL_CLOSE = new Set([4403, 4426]);
/** Скільки чекаємо відповіді на пінг-перевірку, перш ніж вважати сокет мертвим. */
const PROBE_MS = 3_000;
/** Скільки чекаємо відповіді на запит: далі `SignalingError('timeout')`, щоб кнопки не лишались заблокованими. */
const REQUEST_MS = 10_000;

export class SignalingError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export interface SignalingOptions {
  url: string;
  deviceId: string;
  getToken: () => string;
  /** Підміна для тестів. */
  createSocket?: (url: string) => WebSocket;
  onAuthFailed?: () => void;
  /** Чи приховане вікно: передається в `hello` (`hidden`), щоб сервер одразу слав вхідні й через Web Push. */
  getHidden?: () => boolean;
}

type Pending = { resolve: (m: ServerMessage) => void; reject: (e: SignalingError) => void };

/** WebSocket сигналізації: `hello`, пінг, перепідключення з паузою, запити з відповіддю за `reqId`. */
export class SignalingClient {
  private ws?: WebSocket;
  private pending = new Map<string, Pending>();
  private handlers = new Set<(m: ServerMessage) => void>();
  private statusHandlers = new Set<(open: boolean, error?: string) => void>();
  private tries = 0;
  private ping?: ReturnType<typeof setInterval>;
  private retry?: ReturnType<typeof setTimeout>;
  private probe?: ReturnType<typeof setTimeout>;
  private stopped = false;

  constructor(private opts: SignalingOptions) {}

  get open() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  on(fn: (m: ServerMessage) => void) {
    this.handlers.add(fn);
    return () => this.handlers.delete(fn);
  }

  onStatus(fn: (open: boolean, error?: string) => void) {
    this.statusHandlers.add(fn);
    return () => this.statusHandlers.delete(fn);
  }

  connect() {
    this.stopped = false;
    clearTimeout(this.retry);
    clearTimeout(this.probe);
    this.probe = undefined;
    let ws: WebSocket;
    try {
      ws = this.ws = (this.opts.createSocket ?? (u => new WebSocket(u)))(this.opts.url);
    } catch (e) {
      // неправильна адреса чи змішаний https/ws: показуємо причину й пробуємо знову
      this.statusHandlers.forEach(f => f(false, e instanceof Error ? e.message : String(e)));
      this.scheduleRetry();
      return;
    }
    ws.onopen = () => {
      const hidden = this.opts.getHidden?.();
      void this.request('hello', {
        token: this.opts.getToken(),
        deviceId: this.opts.deviceId,
        locale: 'uk',
        ...(hidden !== undefined && { hidden }),
      }).catch(() => {});
    };
    ws.onmessage = e => {
      if (ws !== this.ws) return;
      // будь-який кадр (зокрема `pong`) доводить, що сокет живий
      clearTimeout(this.probe);
      this.probe = undefined;
      let m: ServerMessage;
      try {
        m = JSON.parse(String(e.data));
      } catch {
        return;
      }
      this.dispatch(m);
    };
    ws.onclose = e => {
      if (ws !== this.ws) return;
      clearInterval(this.ping);
      this.rejectAll();
      this.statusHandlers.forEach(f => f(false));
      if (e.code === CLOSE_UNAUTHORIZED) return this.opts.onAuthFailed?.();
      if (FATAL_CLOSE.has(e.code) || this.stopped) return;
      this.scheduleRetry();
    };
  }

  /** Після нового токена від сайту-господаря: або оновлюємо поточну сесію, або підключаємось знову. */
  refreshToken() {
    if (this.open) void this.request('auth.refresh', { token: this.opts.getToken() }).catch(() => {});
    else if (!this.ws || this.ws.readyState > WebSocket.OPEN) this.connect();
  }

  /**
   * Мережа повернулась чи вкладка знову активна: закритий сокет відкриваємо одразу, не чекаючи паузи. Відкритий перевіряємо пінгом:
   * після заморожування у фоні (Android) браузер ще вважає його відкритим, а сервер уже закрив через тишу. Без відповіді за
   * `PROBE_MS` сокет кидаємо й підключаємось наново.
   */
  reconnectNow() {
    if (this.stopped || !this.ws || this.ws.readyState === WebSocket.CONNECTING) return;
    if (this.ws.readyState > WebSocket.OPEN) return this.connect();
    if (this.probe) return;
    this.ws.send(JSON.stringify({ v: PROTOCOL_VERSION, type: 'ping' }));
    this.probe = setTimeout(() => {
      this.probe = undefined;
      const dead = this.ws!;
      this.ws = undefined; // його `onclose` уже нічого не зробить
      clearInterval(this.ping);
      this.rejectAll();
      this.statusHandlers.forEach(f => f(false));
      dead.close();
      this.connect();
    }, PROBE_MS);
  }

  /** Вікно сховали чи показали (`device.visibility`): прихований пристрій сервер кличе й через Web Push. */
  setHidden(hidden: boolean) {
    if (this.open) this.ws!.send(JSON.stringify({ v: PROTOCOL_VERSION, type: 'device.visibility', hidden }));
  }

  close() {
    this.stopped = true;
    clearTimeout(this.retry);
    clearTimeout(this.probe);
    this.probe = undefined;
    clearInterval(this.ping);
    this.ws?.close();
  }

  request(type: string, payload: object = {}): Promise<ServerMessage> {
    return new Promise((resolve, reject) => {
      if (!this.open) return reject(new SignalingError('offline'));
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new SignalingError('timeout'));
      }, REQUEST_MS);
      this.pending.set(id, {
        resolve: m => (clearTimeout(timer), resolve(m)),
        reject: e => (clearTimeout(timer), reject(e)),
      });
      this.ws!.send(JSON.stringify({ v: PROTOCOL_VERSION, type, id, ...payload }));
    });
  }

  private dispatch(m: ServerMessage) {
    if (m.type === 'hello.ok') {
      this.tries = 0;
      clearInterval(this.ping);
      this.ping = setInterval(
        () => this.ws?.send(JSON.stringify({ v: PROTOCOL_VERSION, type: 'ping' })),
        PING_INTERVAL_MS,
      );
      this.statusHandlers.forEach(f => f(true));
    }
    const reqId = 'reqId' in m ? m.reqId : undefined;
    const p = reqId ? this.pending.get(reqId) : undefined;
    if (p && reqId) {
      this.pending.delete(reqId);
      if (m.type === 'error') p.reject(new SignalingError(m.code));
      else p.resolve(m);
    }
    this.handlers.forEach(f => f(m));
  }

  private rejectAll() {
    this.pending.forEach(p => p.reject(new SignalingError('offline')));
    this.pending.clear();
  }

  private scheduleRetry() {
    const base = BACKOFF_S[Math.min(this.tries++, BACKOFF_S.length - 1)]!;
    this.retry = setTimeout(() => this.connect(), base * 1000 * (1 + Math.random() * 0.3));
  }
}
