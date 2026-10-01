import { TokenVerifier } from 'livekit-server-sdk';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { ACCESS_TTL_S, createLiveKit, liveKitIdentity, signAccessToken } from '../src/livekit';
import { LIVEKIT_TEST, signedWebhook } from './helpers';

describe('токен кімнати', () => {
  it('приймається перевіркою з SDK LiveKit, права лише на підключення й медіа', async () => {
    const token = signAccessToken(LIVEKIT_TEST, {
      room: 'call1',
      identity: liveKitIdentity('+380501234567', 'd1'),
      name: 'Ірина',
    });
    const claims = await new TokenVerifier(LIVEKIT_TEST.apiKey, LIVEKIT_TEST.apiSecret).verify(token);
    expect(claims.sub).toBe('+380501234567:d1');
    expect(claims.name).toBe('Ірина');
    expect(claims.video).toEqual({
      room: 'call1',
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: false,
    });
    expect(claims.exp! - claims.nbf!).toBe(ACCESS_TTL_S);
  });

  it('з чужим секретом не проходить перевірку', async () => {
    const token = signAccessToken(LIVEKIT_TEST, { room: 'r', identity: 'i', name: 'n' });
    await expect(new TokenVerifier(LIVEKIT_TEST.apiKey, 'інший'.padEnd(32, 'x')).verify(token)).rejects.toThrow();
  });
});

describe('вебхук', () => {
  const lk = createLiveKit(LIVEKIT_TEST, { deleteRoom: async () => {}, listParticipants: async () => [] });
  const room = { name: 'call1' };

  it.each([
    ['participant_joined', { kind: 'joined', callId: 'call1', identity: 'u:d' }],
    ['participant_left', { kind: 'left', callId: 'call1', identity: 'u:d' }],
    ['room_finished', { kind: 'finished', callId: 'call1' }],
  ])('%s → подія', async (event, expected) => {
    const { text, auth } = await signedWebhook({ event, room, participant: { identity: 'u:d' } });
    expect(await lk.parseWebhook(text, auth)).toMatchObject(expected);
  });

  it('інші події ігноруються, чужий підпис відхиляється', async () => {
    const other = await signedWebhook({ event: 'track_published', room, participant: { identity: 'u:d' } });
    expect(await lk.parseWebhook(other.text, other.auth)).toBeNull();
    const forged = await signedWebhook(
      { event: 'participant_left', room },
      { ...LIVEKIT_TEST, apiSecret: 'f'.repeat(32) },
    );
    await expect(lk.parseWebhook(forged.text, forged.auth)).rejects.toThrow();
    await expect(lk.parseWebhook('{}', undefined)).rejects.toThrow();
  });
});

describe('конфіг LiveKit', () => {
  const base = { JWT_SECRET: 's'.repeat(32) };
  it('вимкнений без змінних, увімкнений з усіма трьома', () => {
    expect(loadConfig(base).livekit).toBeNull();
    expect(
      loadConfig({ ...base, LIVEKIT_URL: 'wss://x', LIVEKIT_API_KEY: 'k', LIVEKIT_API_SECRET: 's' }).livekit,
    ).toEqual({
      url: 'wss://x',
      apiKey: 'k',
      apiSecret: 's',
    });
  });
  it('частково заданий чи відсутній у production: помилка', () => {
    expect(() => loadConfig({ ...base, LIVEKIT_URL: 'wss://x' })).toThrow(/разом/);
    expect(() => loadConfig({ ...base, NODE_ENV: 'production' })).toThrow(/production/);
  });
});
