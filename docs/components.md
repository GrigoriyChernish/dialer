# Компоненти

Каталог Vue-компонентів фронтенду. Кольори й розміри беруться з [дизайн-системи](design-system.md).
Структура папок описана в [architecture.md](architecture.md#структура-папок).

Для кожного компонента: призначення, props, події, стани, доступність.
Коли компонент з'являється в коді або змінює API, оновлюйте цей документ у тому самому коміті.

## Базові: `shared/ui`

### `AppIcon`
Лінійна SVG-іконка.
- **Props:** `name` (`phone`, `x`, `mic`, `cam`, `pause`, `signal`…), `off?: boolean` — перекреслена, `size?: number` (22).
- **Доступність:** декоративна (`aria-hidden`), підпис дає кнопка.

### `UserAvatar`
Кружок з ініціалами.
- **Props:** `name`, `size: 'md' | 'xl'` (48 / 104), `dim?: boolean` — знебарвлений (пропущений дзвінок).

### `CallButton`
Кругла кнопка дзвінка 54×54.
- **Props:** `variant: 'ok' | 'bad' | 'ghost'`, `icon`, `label` (для `aria-label`), `pressed?: boolean` — для перемикачів, `disabled?`, `caption?` — підпис під кнопкою.
- **Події:** `click`.
- **Стани:** звичайна, натиснута (`scale .92`), `pressed` (білий фон), вимкнена.
- **Доступність:** `aria-label`, для перемикачів `aria-pressed`.

### `AppChip`
Невелика кнопка-пігулка в шапці, наприклад перемикач звуку.
- **Props:** `label`. **Події:** `click`.

### `StatusPill`
Статус у верхній частині екрана дзвінка.
- **Props:** `tone: 'warn' | 'neutral' | 'danger'`, `text`; слот `icon`.
- Поява анімацією `in`.

### `AppSpinner`, `SignalBars`, `VoiceWave`
Індикатори: спінер відновлення; смужки сигналу (`level: 1 | 2 | 3`); хвиля голосу (`active: boolean`, без анімації — рівна лінія).

### `MuteBadge`
Червоний кружок з перекресленим мікрофоном.
- **Props:** `size: 'sm' | 'md'`, `title`.

### `LiveRegion`
Невидимий `aria-live="polite"` для скрінрідерів. Один на застосунок, текст бере зі стору дзвінка.

## Контакти: `features/contacts`

### `ContactList`
Картка «Дзвінки» зі списком `ContactRow`.
- **Props:** `contacts`. **Події:** `call(id)`.

### `ContactRow`
Рядок: аватар, ім'я, статус, кнопка виклику.
- **Props:** `contact`. **Події:** `call`.
- **Доступність:** весь рядок — одна кнопка з підписом «Подзвонити {ім'я}».

## Дзвінок: `features/call`

### `CallLayer`
Шар поверх сторінки. Показує потрібний екран залежно від `useCallStore().state`:
`OutgoingCall`, `IncomingCall`, `ActiveCall` або `CallResult`. Нічого не показує в стані `idle` без результату.

### `CallStage`
Спільна рамка екрана дзвінка: 9:16, темний фон, заокруглення. Слоти: `default`, `top`, `controls`.
- **Props:** `tone: 'default' | 'missed'`.

### `OutgoingCall` / `IncomingCall`
Аватар з пульсацією, ім'я, «Дзвонимо…» / «Вхідний дзвінок…», відлік.
- Вихідний: кнопка «Скасувати». Вхідний: «Відхилити» і «Прийняти».
- **Події:** `cancel`, `reject`, `accept`.

### `CallResult`
Екран «Зайнято», «Без відповіді», «Пропущений дзвінок».
- **Props:** `contact`, `reason: 'busy' | 'timeout' | 'missed'`.
- **Події:** `close`, `redial`.

### `ActiveCall`
Екран розмови. Складається з `CallTopBar`, `RemoteParticipant`, `SelfPreview`, `StatusPill`, `CallControls`.

### `CallTopBar`
Ім'я співрозмовника й таймер розмови (`tabular-nums`).
- **Props:** `name`, `seconds`, `micOff`.

### `RemoteParticipant`
Співрозмовник: відео або аватар з бейджами й рядком стану.
- **Props:** `participant`, `state: 'ok' | 'hold' | 'peerhold' | 'away' | 'reconnecting'`, `micOn`, `camOn`.
- **Стани:** як у демо — знебарвлений аватар під час утримання, пунктирне кільце, коли співрозмовник зник,
  обертове кільце під час відновлення. Висота блоку фіксована, щоб вміст не стрибав між станами.
- Слот під кнопку «Продовжити», коли ви поставили співрозмовника на утримання.

### `SelfPreview`
Прев'ю своєї камери в кутку, дзеркальне.
- **Props:** `stream`, `camOn`, `micOn`, `visible`.
- **Події:** `hide`, `show`. Згорнуте — кругла кнопка з іконкою камери.

### `CallControls`
Панель кнопок: мікрофон, камера, утримання, завершити.
- **Props:** `micOn`, `camOn`, `onHold`. **Події:** `toggle-mic`, `toggle-cam`, `toggle-hold`, `hangup`.
- Під час утримання мікрофон і камера вимкнені.

## Налаштування: `pages/Settings`

### `ThemeSwitcher`
Вибір теми: «Системна», «Світла», «Темна». Лише в демо: у віджеті тему задає сайт-господар.
- Працює через `useTheme` (див. [architecture.md](architecture.md#теми)).
- **Доступність:** група радіокнопок з підписом.
