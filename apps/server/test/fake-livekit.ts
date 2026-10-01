import type { LiveKit } from '../src/livekit';

/** LiveKit без мережі: токени-рядки й записи про закриті кімнати. */
export function createFakeLiveKit() {
  const closed: string[] = [];
  const participants = new Map<string, string[]>();
  let failList = false;
  const livekit: LiveKit = {
    accessFor: (callId, identity, name) => ({ url: 'wss://lk.test', token: `${callId}|${identity}|${name}` }),
    parseWebhook: async () => null,
    closeRoom: async (callId) => void closed.push(callId),
    listParticipants: async (callId) => {
      if (failList) throw new Error('LiveKit недоступний');
      return participants.get(callId) ?? [];
    },
  };
  return { livekit, closed, participants, failListing: () => void (failList = true) };
}
