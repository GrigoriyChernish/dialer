import type { LiveKitAccess } from '@dialer/shared';
import { createHmac } from 'node:crypto';
import { RoomServiceClient, WebhookReceiver } from 'livekit-server-sdk';

export interface LiveKitConfig {
  url: string;
  apiKey: string;
  apiSecret: string;
}

/** Подія медіа з вебхука LiveKit, яка цікавить правило `lost`. */
export interface MediaEvent {
  kind: 'joined' | 'left' | 'finished';
  /** Кімната названа за `callId`. */
  callId: string;
  identity?: string;
}

/** Виклики LiveKit API, які можна підмінити в тестах. */
export interface RoomApi {
  deleteRoom(room: string): Promise<void>;
  listParticipants(room: string): Promise<string[]>;
}

export interface LiveKit {
  /** Токен для входу в кімнату. Підписується синхронно, бо це лише HMAC-JWT. */
  accessFor(callId: string, identity: string, name: string): LiveKitAccess;
  /** Перевіряє підпис вебхука й повертає подію, яка потрібна серверу (або `null`). */
  parseWebhook(body: string, authHeader: string | undefined): Promise<MediaEvent | null>;
  /** Закриває кімнату, щоб завершений дзвінок не лишався в медіа. */
  closeRoom(callId: string): Promise<void>;
  listParticipants(callId: string): Promise<string[]>;
}

/** Термін життя токена кімнати, с. */
export const ACCESS_TTL_S = 60 * 60;

/** Ідентичність учасника кімнати: користувач і пристрій. */
export const liveKitIdentity = (userId: string, deviceId: string) => `${userId}:${deviceId}`;

const b64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

/** Токен доступу LiveKit (JWT HS256 із claim `video`), формат за документацією LiveKit. */
export function signAccessToken(
  cfg: Pick<LiveKitConfig, 'apiKey' | 'apiSecret'>,
  grant: { room: string; identity: string; name: string },
  nowMs = Date.now(),
): string {
  const now = Math.floor(nowMs / 1000);
  const head = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url({
    iss: cfg.apiKey,
    sub: grant.identity,
    jti: grant.identity,
    name: grant.name,
    nbf: now,
    exp: now + ACCESS_TTL_S,
    video: { room: grant.room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: false },
  });
  const sig = createHmac('sha256', cfg.apiSecret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
}

/** Для REST-виклику адреса `wss://…` стає `https://…`. */
const restHost = (url: string) => url.replace(/^ws(s?):\/\//, 'http$1://');

export function createRoomApi(cfg: LiveKitConfig): RoomApi {
  const client = new RoomServiceClient(restHost(cfg.url), cfg.apiKey, cfg.apiSecret);
  return {
    deleteRoom: (room) => client.deleteRoom(room),
    listParticipants: async (room) => (await client.listParticipants(room)).map((p) => p.identity),
  };
}

export function createLiveKit(cfg: LiveKitConfig, rooms: RoomApi = createRoomApi(cfg)): LiveKit {
  const receiver = new WebhookReceiver(cfg.apiKey, cfg.apiSecret);
  return {
    accessFor: (callId, identity, name) => ({
      url: cfg.url,
      token: signAccessToken(cfg, { room: callId, identity, name }),
    }),
    async parseWebhook(body, authHeader) {
      const event = await receiver.receive(body, authHeader);
      const callId = event.room?.name;
      if (!callId) return null;
      switch (event.event) {
        case 'participant_joined':
          return { kind: 'joined', callId, identity: event.participant?.identity };
        case 'participant_left':
          return { kind: 'left', callId, identity: event.participant?.identity };
        case 'room_finished':
          return { kind: 'finished', callId };
        default:
          return null;
      }
    },
    closeRoom: (callId) => rooms.deleteRoom(callId),
    listParticipants: (callId) => rooms.listParticipants(callId),
  };
}
