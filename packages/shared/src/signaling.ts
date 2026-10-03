// Контракт сигналізації між віджетом і сервером. Поведінка описана в docs/signaling.md:
// типи й документ мають збігатися, при розбіжності виправляємо обидва в одному коміті.

export const PROTOCOL_VERSION = 1;

// Часові константи, мс
export const RING_TIMEOUT_MS = 60_000; // очікування відповіді
export const LOST_GRACE_MS = 30_000; // скільки кімната LiveKit може бути неповною до `lost`
export const PING_INTERVAL_MS = 25_000; // пінг від клієнта
export const SILENCE_TIMEOUT_MS = 60_000; // сервер закриває з'єднання без пінгів
export const HELLO_TIMEOUT_MS = 5_000; // очікування `hello` після підключення
export const TOKEN_EXPIRING_MS = 60_000; // за скільки до кінця токена йде `token.expiring`
export const ENDED_CALL_TTL_MS = 30_000; // скільки дзвінок лишається в пам'яті після завершення
export const MAX_FRAME_BYTES = 16 * 1024;
export const MAX_INVITES_PER_MINUTE = 10;

// Коди закриття WebSocket
export const CLOSE_UNAUTHORIZED = 4401; // немає hello вчасно, токен недійсний чи прострочений
export const CLOSE_FORBIDDEN = 4403; // користувача заблоковано
export const CLOSE_UNSUPPORTED_VERSION = 4426;

// Ідентифікатори
export type UserId = string; // у демо номер E.164, +380XXXXXXXXX
export type DeviceId = string;
export type CallId = string; // ULID; він же назва кімнати LiveKit

// Спільні сутності

export type CallState = 'ringing' | 'connected';

export type EndReason =
  'hangup' | 'cancelled' | 'rejected' | 'busy' | 'timeout' | 'offline' | 'answered_elsewhere' | 'lost' | 'error';

export type ErrorCode =
  | 'token_invalid'
  | 'token_expired'
  | 'unknown_type'
  | 'bad_request'
  | 'unsupported_version'
  | 'invalid_target'
  | 'already_in_call'
  | 'call_not_found'
  | 'call_ended'
  | 'not_allowed'
  | 'rate_limited'
  | 'internal';

export interface Peer {
  userId: UserId;
  name: string;
}

export interface LiveKitAccess {
  url: string;
  token: string;
}

export interface CallInfo {
  callId: CallId;
  direction: 'out' | 'in';
  peer: Peer;
  state: CallState;
  /** Вхідний ringing, коли в користувача вже є розмова. */
  waiting?: boolean;
  /** connected: ми тримаємо співрозмовника. */
  hold?: boolean;
  /** connected: співрозмовник тримає нас. */
  peerHold?: boolean;
  /** ringing: коли закінчується очікування, мс (час сервера). */
  expiresAt?: number;
  /** connected: момент відповіді, мс. */
  startedAt?: number;
  /** connected: доступ до кімнати LiveKit. */
  livekit?: LiveKitAccess;
}

export interface Settings {
  /** Другий вхідний під час розмови дзвонить як «очікування». */
  waiting: boolean;
  /** «Не турбувати»: усі вхідні отримують busy. */
  dnd: boolean;
}

export const DEFAULT_SETTINGS: Settings = { waiting: true, dnd: false };

export interface Contact {
  userId: UserId;
  name: string;
  online: boolean;
}

export type RecentResult = 'completed' | 'cancelled' | 'rejected' | 'busy' | 'no_answer' | 'missed' | 'failed';

export interface RecentEntry {
  callId: CallId;
  peer: UserId;
  direction: 'out' | 'in';
  result: RecentResult;
  startedAt: number;
  /** Секунди розмови. */
  duration?: number;
  /** Тихий пропущений: видно в «Історії», але не збільшує лічильник. */
  silent?: boolean;
}

// Кадри. Кожен має версію протоколу й тип; решта полів залежить від типу.

interface Frame<T extends string> {
  v: typeof PROTOCOL_VERSION;
  type: T;
}

/** Запит клієнта: `id` потрібен для відповіді й повтору без дубля. */
type Request<T extends string, P = object> = Frame<T> & { id: string } & P;

// Клієнт → сервер

export type HelloRequest = Request<'hello', { token: string; deviceId: DeviceId; locale?: string }>;
export type PingRequest = Frame<'ping'> & { id?: string };
export type AuthRefreshRequest = Request<'auth.refresh', { token: string }>;
export type CallInviteRequest = Request<'call.invite', { to: UserId; video: boolean }>;
export type CallCancelRequest = Request<'call.cancel', { callId: CallId }>;
/** `action` обов'язкове, якщо в користувача вже є розмова (вхідний із `waiting`). */
export type CallAcceptRequest = Request<'call.accept', { callId: CallId; action?: 'hold' | 'end' }>;
export type CallRejectRequest = Request<'call.reject', { callId: CallId }>;
export type CallHangupRequest = Request<'call.hangup', { callId: CallId }>;
export type CallHoldRequest = Request<'call.hold', { callId: CallId; hold: boolean }>;
export type SettingsUpdateRequest = Request<'settings.update', { settings: Partial<Settings> }>;
/** Нове ім'я користувача: 2–40 символів після обрізання пробілів. */
export type ProfileUpdateRequest = Request<'profile.update', { name: string }>;
/** Історію переглянуто до `upTo` (мс від епохи); сервер бере більше з наявного й нового, а майбутній час обрізає до «зараз». */
export type RecentsSeenRequest = Request<'recents.seen', { upTo: number }>;
export type PushSubscribeRequest = Request<'push.subscribe', { subscription: unknown }>;
export type PushUnsubscribeRequest = Request<'push.unsubscribe', object>;

export type ClientMessage =
  | HelloRequest
  | PingRequest
  | AuthRefreshRequest
  | CallInviteRequest
  | CallCancelRequest
  | CallAcceptRequest
  | CallRejectRequest
  | CallHangupRequest
  | CallHoldRequest
  | SettingsUpdateRequest
  | ProfileUpdateRequest
  | RecentsSeenRequest
  | PushSubscribeRequest
  | PushUnsubscribeRequest;

// Сервер → клієнт

/** Відповідь на запит: `reqId` збігається з `id` запиту. */
type Reply<T extends string, P = object> = Frame<T> & { reqId: string } & P;

export type HelloOk = Reply<
  'hello.ok',
  {
    user: Peer;
    serverTime: number;
    settings: Settings;
    /** Дзвінки користувача в процесі, від 0 до 2. */
    calls: CallInfo[];
    contacts: Contact[];
    recents: RecentEntry[];
    /** До якого часу історію переглянуто (мс): пропущені новіші за нього рахуються в лічильнику. */
    recentsSeenUpTo: number;
  }
>;
/** Порожній ack, або з `call` (на `call.invite`), або з повними `settings` (на `settings.update`). */
export type Ack = Reply<'ack', { call?: CallInfo; settings?: Settings; user?: Peer }>;
export type ErrorReply = Frame<'error'> & {
  reqId?: string;
  code: ErrorCode;
  /** Для логів; тексти для людей живуть в i18n за `code`. */
  message?: string;
};
export type Pong = Frame<'pong'>;
export type TokenExpiring = Frame<'token.expiring'>;
export type CallRinging = Frame<'call.ringing'> & { call: CallInfo };
export type CallIncoming = Frame<'call.incoming'> & { call: CallInfo };
export type CallConnected = Frame<'call.connected'> & { call: CallInfo };
export type CallEnded = Frame<'call.ended'> & {
  callId: CallId;
  reason: EndReason;
  duration?: number;
};
export type CallPeer = Frame<'call.peer'> & { callId: CallId; hold: boolean };
export type CallUpdated = Frame<'call.updated'> & {
  callId: CallId;
  hold?: boolean;
  waiting?: boolean;
};
export type PresenceEvent = Frame<'presence'> & { userId: UserId; online: boolean };
export type ContactsUpdate = Frame<'contacts.update'> & {
  upsert: Contact[];
  remove: UserId[];
};
export type RecentsAdd = Frame<'recents.add'> & { entry: RecentEntry };
export type SettingsUpdated = Frame<'settings.updated'> & { settings: Settings };
export type ProfileUpdated = Frame<'profile.updated'> & { user: Peer };
/** Інший пристрій переглянув історію: лічильник пропущених скидається і тут. */
export type RecentsSeen = Frame<'recents.seen'> & { upTo: number };

export type ServerMessage =
  | HelloOk
  | Ack
  | ErrorReply
  | Pong
  | TokenExpiring
  | CallRinging
  | CallIncoming
  | CallConnected
  | CallEnded
  | CallPeer
  | CallUpdated
  | PresenceEvent
  | ContactsUpdate
  | RecentsAdd
  | SettingsUpdated
  | ProfileUpdated
  | RecentsSeen;

export type ClientMessageType = ClientMessage['type'];
export type ServerMessageType = ServerMessage['type'];

// Web Push

export interface PushIncoming {
  type: 'call.incoming';
  callId: CallId;
  from: Peer;
  expiresAt: number;
}

export interface PushEnded {
  type: 'call.ended';
  callId: CallId;
}

export type PushPayload = PushIncoming | PushEnded;
