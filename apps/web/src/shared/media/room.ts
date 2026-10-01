import type { LiveKitAccess } from '@dialer/shared';
import { Room, RoomEvent, type RemoteTrack } from 'livekit-client';

/** Обгортка над livekit-client: аудіо розмови. Мікрофон і приглушення співрозмовника керуються ззовні. */
export class CallMedia {
  private room?: Room;
  private els: HTMLMediaElement[] = [];
  private gen = 0;
  private micOn = true;
  private deaf = false;

  async join(access: LiveKitAccess) {
    this.leave();
    const gen = this.gen;
    const room = (this.room = new Room());
    room.on(RoomEvent.TrackSubscribed, (t: RemoteTrack) => {
      if (t.kind !== 'audio') return;
      const el = t.attach();
      el.muted = this.deaf;
      document.body.append(el);
      this.els.push(el);
    });
    room.on(RoomEvent.TrackUnsubscribed, (t: RemoteTrack) =>
      t.detach().forEach((el) => {
        el.remove();
        this.els = this.els.filter((x) => x !== el);
      }),
    );
    try {
      await room.connect(access.url, access.token);
      if (gen !== this.gen) return void room.disconnect();
      await room.startAudio();
      this.apply();
    } catch (e) {
      console.warn('livekit', e);
    }
  }

  setMic(on: boolean) {
    this.micOn = on;
    this.apply();
  }

  /** Утримання: не чуємо співрозмовника. */
  setDeaf(deaf: boolean) {
    this.deaf = deaf;
    this.apply();
  }

  leave() {
    this.gen++;
    this.room?.disconnect();
    this.room = undefined;
    this.els.forEach((el) => el.remove());
    this.els = [];
  }

  private apply() {
    void this.room?.localParticipant.setMicrophoneEnabled(this.micOn && !this.deaf).catch(() => {});
    this.els.forEach((el) => (el.muted = this.deaf));
  }
}
