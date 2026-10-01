import { createI18n } from 'vue-i18n';

export const messages = {
  uk: {
    contacts: { title: 'Дзвінки', online: 'онлайн', offline: 'не в мережі', demo: 'демо-співрозмовник', bot: { answers: 'онлайн · відповість', ignores: 'онлайн · не відповість', busy: 'у розмові · зайнято' }, noConnection: "Немає зв'язку з сервером", connecting: 'Підключаємось…', call: 'Подзвонити' },
    call: {
      calling: 'Дзвонимо…', outgoing: 'Вихідний виклик', incomingLabel: 'Вхідний виклик', you: 'Ви', camOff: 'Камера вимк.', micUnavailable: 'Мікрофон недоступний',
      self: { hold: 'Ви на утриманні', micOff: 'Мікрофон вимкнено', micUnavailable: 'Мікрофон недоступний', camOff: 'Камера вимкнена', camUnavailable: 'Камера недоступна' }, camera: 'Вимкнути камеру', cameraOn: 'Увімкнути камеру', cameraUnavailable: 'Камера недоступна', hideSelf: 'Сховати себе', showSelf: 'Показати себе', incoming: 'Вхідний дзвінок…', left: 'Залишилось {time}',
      accept: 'Прийняти', reject: 'Відхилити', cancel: 'Скасувати', hangup: 'Завершити',
      mute: 'Вимкнути мікрофон', unmute: 'Увімкнути мікрофон', hold: 'Утримання', resume: 'Продовжити',
      notice: { cameraUnavailable: 'Камера недоступна', micUnavailable: 'Мікрофон недоступний' },
      network: { poorSignal: 'Слабкий сигнал', reconnecting: "Відновлюємо ваше з'єднання" },
      peer: {
        hold: { f: '{name} поставила на утримання', m: '{name} поставив на утримання' },
        connectionLost: { f: "{name} втратила з'єднання · чекаємо до 30 с", m: "{name} втратив з'єднання · чекаємо до 30 с" },
        micOff: { f: '{name} вимкнула мікрофон', m: '{name} вимкнув мікрофон' },
      },
      close: 'Закрити', redial: 'Передзвонити',
      missed: { busy: 'Зайнято', rejected: 'Відхилено', timeout: 'Без відповіді', incoming: 'Пропущений дзвінок', error: 'Не вдалося зателефонувати' },
      missedNote: { busy: 'Абонент зараз розмовляє', rejected: 'Абонент відхилив дзвінок', timeout: 'Абонент не відповів', incoming: 'Ви не відповіли на вхідний' },
      err: { generic: 'Спробуйте ще раз', alreadyInCall: 'Ви вже на дзвінку', invalidTarget: 'Такого користувача немає', rateLimited: 'Забагато дзвінків, зачекайте хвилину', offline: "Немає зв'язку з сервером" },
    },
    sound: { on: 'Звук: вкл', off: 'Звук: вимк' },
  },
};

export const i18n = createI18n({ legacy: false, locale: 'uk', fallbackLocale: 'uk', messages });
