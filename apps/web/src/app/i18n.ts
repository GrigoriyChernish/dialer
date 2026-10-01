import { createI18n } from 'vue-i18n';

export const messages = {
  uk: {
    contacts: { title: 'Дзвінки', online: 'онлайн', offline: 'не в мережі', demo: 'демо-співрозмовник', bot: { answers: 'онлайн · відповість', ignores: 'онлайн · не відповість', busy: 'у розмові · зайнято' }, noConnection: "Немає зв'язку з сервером", connecting: 'Підключаємось…', call: 'Подзвонити' },
    call: {
      calling: 'Дзвонимо…', outgoing: 'Вихідний виклик', incomingLabel: 'Вхідний виклик', you: 'Ви', incoming: 'Вхідний дзвінок…', left: 'Залишилось {time}',
      accept: 'Прийняти', reject: 'Відхилити', cancel: 'Скасувати', hangup: 'Завершити',
      mute: 'Вимкнути мікрофон', unmute: 'Увімкнути мікрофон', hold: 'Утримання', resume: 'Продовжити',
      youHold: 'Ви поставили на утримання', peerHold: '{name} поставив(ла) на утримання', close: 'Закрити', redial: 'Передзвонити',
      missed: { busy: 'Зайнято', rejected: 'Відхилено', timeout: 'Без відповіді', incoming: 'Пропущений дзвінок', error: 'Не вдалося зателефонувати' },
      missedNote: { busy: 'Абонент зараз розмовляє', rejected: 'Абонент відхилив дзвінок', timeout: 'Абонент не відповів', incoming: 'Ви не відповіли на вхідний' },
      err: { generic: 'Спробуйте ще раз', alreadyInCall: 'Ви вже на дзвінку', invalidTarget: 'Такого користувача немає', rateLimited: 'Забагато дзвінків, зачекайте хвилину', offline: "Немає зв'язку з сервером" },
    },
    sound: { on: 'Звук: вкл', off: 'Звук: вимк' },
  },
};

export const i18n = createI18n({ legacy: false, locale: 'uk', fallbackLocale: 'uk', messages });
