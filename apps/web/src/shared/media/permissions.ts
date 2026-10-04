/** Стан дозволу з Permissions API, або `null`, якщо браузер його не підтримує (Safari не знає `microphone` і `camera`). */
async function queryPermission(name: 'microphone' | 'camera'): Promise<PermissionState | null> {
  try {
    if (!('permissions' in navigator) || !navigator.permissions?.query) return null;
    return (await navigator.permissions.query({ name: name as PermissionName })).state;
  } catch {
    return null;
  }
}

/**
 * Запит дозволів на мікрофон і камеру до першого дзвінка та підписка на їхній стан.
 * Отримані тимчасові треки одразу зупиняються, щоб індикатор запису не залишався активним.
 */
export async function requestMediaPermissions(): Promise<{ audio: boolean; video: boolean }> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return { audio: false, video: false };
  }

  // Permissions API: якщо рішення вже є, getUserMedia не викликаємо (інакше щоразу блимає індикатор камери, а за «denied» марно чекаємо відмови)
  const [mic, cam] = await Promise.all([queryPermission('microphone'), queryPermission('camera')]);
  if (mic === 'granted' && cam === 'granted') return { audio: true, video: true };
  if (mic === 'denied') return { audio: false, video: cam === 'granted' };

  try {
    // Пробуємо отримати обидва дозволи одним системним запитом
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    stream.getTracks().forEach(t => t.stop());
    return { audio: true, video: true };
  } catch {
    // Якщо комбінований запит не вдався (наприклад, немає камери), пробуємо отримати хоча б аудіо
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStream.getTracks().forEach(t => t.stop());
      return { audio: true, video: false };
    } catch {
      return { audio: false, video: false };
    }
  }
}

export interface PermissionStatusResult {
  micDenied: boolean;
  camDenied: boolean;
}

/**
 * Підписка на зміни дозволів у браузері (Permissions API) та зміну пристроїв (devicechange).
 */
export function watchMediaPermissions(onChange: (res: PermissionStatusResult) => void): () => void {
  if (typeof navigator === 'undefined') return () => {};

  let unsub = false;
  const cleanups: (() => void)[] = [];

  const update = async () => {
    if (unsub) return;
    let micDenied = false;
    let camDenied = false;

    if ('permissions' in navigator && navigator.permissions?.query) {
      try {
        const mic = await navigator.permissions.query({ name: 'microphone' as PermissionName });
        micDenied = mic.state === 'denied';
      } catch {
        /* empty */
      }
      try {
        const cam = await navigator.permissions.query({ name: 'camera' as PermissionName });
        camDenied = cam.state === 'denied';
      } catch {
        /* empty */
      }
    }

    onChange({ micDenied, camDenied });
  };

  void update();

  if ('permissions' in navigator && navigator.permissions?.query) {
    void navigator.permissions
      .query({ name: 'microphone' as PermissionName })
      .then(status => {
        if (unsub) return;
        status.onchange = () => void update();
        cleanups.push(() => {
          status.onchange = null;
        });
      })
      .catch(() => {});

    void navigator.permissions
      .query({ name: 'camera' as PermissionName })
      .then(status => {
        if (unsub) return;
        status.onchange = () => void update();
        cleanups.push(() => {
          status.onchange = null;
        });
      })
      .catch(() => {});
  }

  if (navigator.mediaDevices?.addEventListener) {
    const onDeviceChange = () => void update();
    navigator.mediaDevices.addEventListener('devicechange', onDeviceChange);
    cleanups.push(() => navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange));
  }

  return () => {
    unsub = true;
    cleanups.forEach(fn => fn());
  };
}
