# Компоненти

Каталог Vue-компонентів `apps/web`. **Дизайн — головне джерело:** компоненти й екрани описані у [`design/dialer.pen`](../design/dialer.pen),
кольори й розміри в [дизайн-системі](design-system.md). Якщо цей документ розходиться з дизайном, правий дизайн.
Структура папок: [architecture.md](architecture.md#структура-папок).

Коли компонент з'являється в коді або змінює API, оновлюйте цей документ у тому самому коміті.

## Відповідність дизайну

Групи збігаються з контейнерами `Components · …` у [`design/dialer.pen`](../design/dialer.pen), див. [design-system.md](design-system.md#структура-файлу-дизайну).

| Група в дизайні | Компонент у дизайні | Компонент у коді | Стан |
| --- | --- | --- | --- |
| Base | `Status Bar` | немає (системна смуга телефона, у віджеті її не малюємо) | не потрібен |
| Base | `Call Header` | `<header>` у `features/call/CallScreen.vue` | є |
| Base | `Call Controls` | панель кнопок у `CallScreen.vue` | є |
| Base | `Self View` | мініатюра у `CallScreen.vue` + `shared/ui/VideoSurface.vue` | є; відео з реальним потоком не перевірено на двох пристроях |
| Base | `Action Button` і варіанти `/ active`, `/ danger`, `/ success`, `/ subtle`, `/ disabled` | `shared/ui/RoundButton.vue`: `ghost`, `ghost` + `active`, `bad`, `ok`, `subtle`, `unavailable` | є |
| Base | `Labeled Action` | кнопка з підписом у `CallScreen.vue` | є |
| Base | `Show Self` | кнопка «показати себе» у `CallScreen.vue` | є |
| Base | (аватар у кожному екрані) | `shared/ui/Avatar.vue` | є |
| Base | lucide-іконки | `shared/ui/Icon.vue` | є |
| Contacts | `Contact Meta`, `Contact Row`, `Contact List` | `pages/ContactsPage.vue` (одним файлом) | є, без кнопки чату |
| Auth | `Text Field` (+ `/ focused`, `/ error`), `Primary Button` (+ `/ disabled`), `Code Cell` (+ `/ focused`, `/ error`), `Icon Button` | `pages/LoginPage.vue` (одним файлом) | є |
| Auth | `App Header` | шапка в `pages/HomePage.vue` | є |
| Екрани | `Auth · Phone`, `Auth · Name`, `Auth · Code`, помилки | `pages/LoginPage.vue` | є |
| Self Status | `Self Status / *` (5 значків) | `shared/ui/SelfStatusChip.vue` | є |
| Banners | `Banner` | `shared/ui/Banner.vue` | є |
| Banners | `Self Banner / *`, `Peer Banner / *` | `shared/ui/banners.ts` + `BannerStack.vue` | є |
| Peer | `Peer`, `Peer Ring`, `Call Label`, `Result Label` | `features/call/Peer.vue` (+ підписи в слоті з `CallScreen.vue`) | є |
| Peer | `Voice Wave`, `Voice Wave / silent` | `shared/ui/VoiceWave.vue` (`silent`) | є |
| Peer | `Peer Video` | `shared/ui/VideoSurface.vue` (`kind: 'remote'`) у `CallScreen.vue` | є |
| Екрани | `Outgoing Call`, `Incoming Call`, `In Call`, `Result · *`, усі стани розмови | `features/call/CallScreen.vue` | є |

## Базові: `shared/ui`

### `Icon`

Іконка lucide за ім'ям: `video`, `videoOff`, `phone`, `phoneOutgoing`, `phoneIncoming`, `phoneOff`, `phoneMissed`, `x`, `pause`, `mic`, `micOff`, `wifiOff`, `loader`, `signalLow`.

- **Розмір:** за замовчуванням 24; менші задає викликач класом `size-*` (16 у підписах і плашках, 18 у результаті, 12 у бейджі). Власного розміру компонент не нав'язує.
- **Доступність:** декоративна (`aria-hidden`), підпис дає кнопка.

### `Avatar`

Кружок з ініціалами, градієнт 135° з трьох палітр дизайну: `accent → avatar-end`, `avatar-teal → avatar-blue`, `avatar-amber → avatar-red`.
  Палітру обирає хеш імені, тож вона однакова в списку й на екрані дзвінка; демо-боти отримують палітри з дизайну (Олена, Андрій, Support).

- **Props:** `name`, `size?: 'md' | 'xl'` (48 / 104), `opacity?: number` (.6 під час утримання й втрати зв'язку),
  `muted?: boolean` — сірий аватар екрана результату (градієнт `#6B7080 → #7A6E86`, `avatar-muted-*`, прозорість .55).

### `RoundButton` (`Action Button`)

Кругла кнопка 54 × 54.

- **Props:** `variant: 'ok' | 'bad' | 'ghost' | 'subtle'` (`subtle` — світліше скло, «Закрити» на результаті), `label` (для `aria-label`), `active?: boolean` — увімкнений перемикач (білий фон, темна іконка).
- **Слот:** іконка. **Стани:** звичайна, натиснута (`scale .95`), `active`, вимкнена. `bad` і `ok` мають тінь свого кольору (`shadow-bad`, `shadow-ok`).

### `Banner` (базовий) і похідні `Self Banner / *`, `Peer Banner / *`

Базова смужка-пігулка сповіщення. Похідні (див. `shared/ui/banners.ts`) лише задають тон, іконку й текст, власного вигляду не мають.

- **Props:** `tone: 'warn' | 'accent' | 'bad' | 'neutral'`, `icon` (ім'я з `Icon`), `spin?: boolean` (іконка крутиться, для `loader`). **Слот:** текст.
- Вигляд: радіус 20, підкладка `bg`, градієнт тону й рамка розчиняються вправо (див. [design-system.md](design-system.md#смужки-сповіщень-banner)); `pointer-events-none`.
- Нижній відступ 8 лежить у корені, тож проміжок між смужками анімується разом із ними. **Доступність:** `role="status"`.
- Позиціонування: смужка лежить поверх екрана, її розміщує `BannerStack` (абсолютно під шапкою), тож вміст не зсувається.

### `BannerStack`

Стек смужок із анімацією. **Props:** `items: { id, tone, icon, text, spin? }[]`. Батько ставить його абсолютно
(`CallScreen`: `absolute inset-x-4 top-[46px]`), стек не бере місця в розкладці.

- Нове сповіщення додається елементом масиву з унікальним `id`, зникає, коли його прибрано; кожне анімується окремо:
  поява 220 мс `ease-out`, зникнення 180 мс `ease-in` (висота, прозорість, зсув 4 px). `prefers-reduced-motion` вимикає анімацію.
- Текст лишається до кінця зникнення.
- Додати нове сповіщення: вид у `banners.ts`, рядок у `banners` екрана розмови (`CallScreen`) і `Self Banner / <назва>` у дизайні.

### `SelfStatusChip` (`Self Status / *`)

Значок нашого стану в шапці розмови: круг 22 × 22, іконка 12.

- **Props:** `status: 'hold' | 'micOff' | 'micUnavailable' | 'camOff' | 'camUnavailable'`, `label` (для `aria-label` і `title`).
- Лише значок, без дій. Правила показу й порядок в [design-system.md](design-system.md#наші-статуси-self-status).

### `VideoSurface`

Відео з кімнати LiveKit в елементі `<video>`: `kind: 'remote'` співрозмовника, `'local'` нашої камери (дзеркально).

- **Props:** `kind`, `track` — прапорець, що потік з'явився чи зник (за ним відео підключається знову).
- Без звуку: аудіо йде окремими елементами в `CallMedia`.

## Контакти: `pages/ContactsPage`

Картка з рядками контактів: аватар, ім'я, крапка статусу з підписом, кнопка виклику 36 × 36 з іконкою `phone` 16.

- Порядок: демо-боти (Олена, Андрій, Support), далі люди, ті, хто в мережі, вище.
- Статуси ботів збігаються з їхніми сценаріями: «відповість» (зелена), «не відповість» (жовта), «зайнято» (червона).
- Весь рядок — кнопка з підписом «Подзвонити: {ім'я}». Кнопки чату з дизайну немає, бо немає чату.
- Без з'єднання з сервером довше за 3 с показує «Немає зв'язку з сервером…» з причиною (короткі розриви не блимають).

## Застосунок: вхід і головна (`entries/app.ts`)
Окрема сторінка `index.html` для GitHub Pages; віджет для iframe — `widget.html` (`entries/widget.ts`). Маршрути в hash:
`#/login` для гостей, `#/` після входу (гард перенаправляє).

### `LoginPage` (дизайн: `Flow · Auth`)
Три кроки однієї сторінки: номер (`+380` і 9 цифр, вставка `+380…`/`0…` нормалізується) → ім'я (лише для нового номера) → код.
Підтверджений раніше номер після «Далі» одразу входить: код питаємо один раз на номер.
- Код: чотири клітинки поверх прозорого `<input autocomplete="one-time-code">`, тож працюють вставка й автозаповнення; після 4 цифр
  форма відправляється сама. Невірний код очищує клітинки й показує, скільки спроб лишилось.
- Помилки сервера з `auth.err.*` (i18n) під полем, `role="alert"`. «Назад» і «Змінити номер» повертають на попередній крок.
- Підказки, що код — останні 4 цифри номера, навмисно немає.

### `HomePage`
Шапка (`App Header`): назва застосунку «Call» і кнопка «Вийти» (`log-out`, 44 × 44), під нею `ContactsPage`.

### `features/auth/session.ts` (`useSessionStore`)
Сесія в `localStorage` (`dialer.session`): токен доступу, `refreshToken`, строки. `start`, `verify`, `refresh`, `logout`.
- `refresh` за хвилину до кінця токена доступу й за `token.expiring`; новий токен іде в сигналізацію (`auth.refresh`).
- Сесія недійсна (`session_invalid`) → вихід; сервер недоступний → сесія лишається, спробуємо пізніше.
- Вихід перезавантажує сторінку на `#/login`, щоб скинути стан дзвінків і контактів.

## Дзвінок: `features/call`

### `store.ts` (`useCallStore`)

Стан дзвінка належить серверу: стор надсилає наміри (`call.invite`, `call.accept`, `call.hangup` …), а екран міняє за подіями
(див. [signaling.md](signaling.md#відповідність-дій-клієнта)). Отримує залежності через `init({ client, media, sounds })`, тож тестується без мережі.

- Стан: `status` (`idle` / `ringing` / `incoming` / `connected`), `peer`, `hold`, `peerHold`, `mic`, `link` (стан зв'язку з кімнати LiveKit), `missed`, `left`, `seconds`.
- Дії: `call`, `accept`, `end` (відхилити, скасувати чи завершити залежно від стану), `toggleHold`, `toggleMic`, `dismissMissed`.

### `Peer`

Блок співрозмовника 327 × 336 з трьома зонами фіксованої висоти (див. [design-system.md](design-system.md#блок-співрозмовника-peer)).

- **Props:** `name`, `variant?: 'default' | 'dimmed' | 'result'`, `ringing?: boolean` (виклик: кільця й пульсація; під час розмови й на результаті кілець немає). **Слот:** вміст зони Status.
- Розміщується `CallScreen` абсолютно на одній висоті (`.peer-pos`: `top: clamp(16px, 100% - 506px, 158px)`), тож шапка й кнопки його не зсувають.

### `VoiceWave`

Хвиля голосу: 5 смуг. **Props:** `silent?: boolean` — пласка приглушена (голосу немає: утримання, обрив, вимкнений мікрофон).

### `CallScreen`

Шар поверх сторінки, показує екран за станом стору:

- **`ringing` / `incoming`:** кільця 200/152, аватар 104, ім'я 26/700, підпис «Вихідний/Вхідний виклик» з іконкою, «Залишилось 00:08».
  Вихідний: «Скасувати». Вхідний: «Відхилити» й «Прийняти» з підписами.
- **`connected`:** шапка з ім'ям, нашими статусами (`SelfStatusChip`) і таймером, мініатюра «Ви» 92 × 122, аватар, хвиля голосу **або** плашка стану (одна, під іменем),
  панель керування (мікрофон, камера, утримання, завершити).
- **З відео співрозмовника** (`link.peerCam`): відео на весь екран із градієнтами згори (180) і знизу (220), без аватара й імені,
  смужка співрозмовника лишається внизу.
- **Мініатюра себе:** з нашим відео (дзеркально), коли камера працює; «Ви» без відео; «Камера вимк.», коли камеру вимкнено;
  Натискання згортає її в кнопку 44 × 44 (`video`), натискання на кнопку повертає.
- Камера вмикається разом із розмовою. **Якщо камери немає чи немає дозволу** (`camBlocked`: немає `videoinput` у `enumerateDevices` або `camError` від LiveKit),
  мініатюру себе й кнопку «показати себе» не показуємо, а кнопка камери приглушена (`aria-disabled`, але натискається): натискання на 4 с показує смужку
  «Камера недоступна» (`hint`). Це інакше, ніж коли користувач сам вимкнув камеру:
  тоді мініатюра лишається з написом «Камера вимк.», як у дизайні. Блокування діє до кінця дзвінка й перевіряється наново в кожному.
- Під час утримання камера й мікрофон вимкнені.
- **Результат** (`idle` із `missed`): сірий аватар без кілець, «Зайнято» (`phone-off`), «Без відповіді» й «Пропущений дзвінок» (`phone-missed`),
  причина, кнопки «Закрити» й «Передзвонити».

Співрозмовник: смужка `Peer Banner` внизу над панеллю керування (`BannerStack` з `absolute bottom-[122px]`), одна за раз: утримання співрозмовником,
втрата зв'язку, мікрофон співрозмовника; поки вона є, хвилю голосу під іменем ховаємо.
Наш бік: значки `SelfStatusChip` у шапці і верхній `BannerStack` під нею (наша мережа, потім сповіщення «Камера/Мікрофон недоступні» на 4 с).
Усі смужки лежать поверх екрана й не зсувають вміст.

## Медіа й сигналізація: `shared`

- `api/auth.ts` — HTTP-вхід (`/auth/start`, `/verify`, `/refresh`, `/logout`), помилки як `AuthError` (`network`, якщо сервер недоступний).
- `api/signaling.ts` — `SignalingClient`: `hello`, пінг, перепідключення 1, 1, 2, 3, 5 с із зсувом і одразу при `online` чи поверненні у вкладку (`reconnectNow`), запити з відповіддю за `reqId`.
- `media/room.ts` — `CallMedia` над `livekit-client`: аудіо розмови, мікрофон, приглушення на утриманні; віддає `LinkState`
  (`reconnecting`, `poor`, `peerAway`, `peerMuted`) із подій кімнати.
- `sounds/sounds.ts` — гудки й мелодії через Web Audio.

## Ще не зроблено (є в дизайні)

Кнопка чату (`message-circle`). Див. беклог, пункт 18.
