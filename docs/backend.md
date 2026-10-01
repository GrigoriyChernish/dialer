# Бекенд

Сервер дзвонілки: токени, сигналізація, історія, пуші. Живе в `apps/server` цього ж моноrepo.
Протокол сигналізації описано в [signaling.md](signaling.md), загальну картину в [architecture.md](architecture.md).

## Рішення
| Що | Вибір | Чому |
|---|---|---|
| Runtime | Node 22, TypeScript | спільні типи сигналізації з фронтендом через `packages/shared` |
| WebSocket | нативний, бібліотека `ws` | протокол, ack, повторні запити й відновлення стану вже описані в `signaling.md`; Socket.IO дублював би їх і важив би ~40 КБ у віджеті |
| HTTP | Fastify | токени, демо-вхід, вебхук LiveKit, health |
| БД | SQLite (`better-sqlite3`) | один інстанс, без окремого сервісу; запити прості, перехід на Postgres лишається можливим |
| Токен користувача | JWT | самодостатній, перевірка без запиту; короткий термін життя замінює відкликання |
| Медіа | LiveKit Cloud | не підтримуємо власні SFU й TURN |
| Хостинг | Fly.io | WebSocket і HTTPS з коробки, публічна адреса для вебхуків LiveKit, томи для SQLite |
| Тести | Vitest | юніт-тести логіки дзвінків, інтеграційні з двома WebSocket-клієнтами |

Залежності мінімальні: `ws`, `fastify`, `better-sqlite3`, `jose` (JWT), `livekit-server-sdk`, `pino`; `web-push` додамо з кроком 6 (Web Push).

## Запуск
```bash
pnpm install                          # з кореня репозиторію
cp apps/server/.env.example apps/server/.env   # без JWT_SECRET працює ключ для розробки
pnpm --filter @dialer/server dev      # http://localhost:8787, WebSocket ws://localhost:8787/ws
pnpm test                             # усі тести; лише сервер: pnpm --filter @dialer/server test
pnpm typecheck
```
Сервер запускається через `tsx` без збірки, `start` робить те саме без перезапуску при змінах.
У `production` без `JWT_SECRET` (від 32 символів) сервер не стартує.

## Структура `apps/server`
```
apps/server/
  src/
    main.ts          # запуск: конфіг, БД, HTTP, WebSocket
    http/            # /demo/login, /tokens, /livekit/webhook, /health
    ws/              # підключення, hello, диспетчер кадрів, закриття з кодами
    calls/           # машина станів, правила call.invite, таймери (без залежності від ws і БД)
    store/           # присутність і активні дзвінки: інтерфейси та реалізація в пам'яті
    db/              # SQLite: схема, міграції, запити
    auth/            # видача й перевірка JWT, ключі сайтів
    livekit/         # токени кімнат, перевірка вебхуків
    push/            # Web Push
    bots/            # демо-співрозмовники
  migrations/        # SQL-файли 001_init.sql …
  test/
```
- `calls/` чиста логіка: отримує подію й поточний стан, повертає нові стани й повідомлення. Її тестуємо таблицею
  випадків (порядок перевірок у `call.invite` з [signaling.md](signaling.md#порядок-перевірок-у-callinvite)) без мережі.
- Присутність і активні дзвінки доступні лише через інтерфейси `store/`, а не через розкидані `Map`.
  Це залишає шлях до кількох інстансів, хоча зараз інстанс один.

## Як працює дзвінок на сервері
- `calls/service.ts` тримає всю логіку. Команда (`invite`, `accept` …) повертає `{ call?, effects }`: `call` йде в `ack`, а `effects`
  це повідомлення `{ userId, deviceId?, exceptDeviceId?, msg }`. Шлюз спершу надсилає `ack`, потім `deliver(effects)`,
  тому клієнт завжди бачить `ack` раніше за події (`call.ended` для `busy` приходить після `ack` на `call.invite`).
- Таймери (60 с очікування, відповідь ботів, забування завершених дзвінків через 30 с) працюють через `Clock`, у тестах це
  годинник, який рухається вручну (`test/fake-clock.ts`). Події від таймерів сервіс доставляє сам через `deliver`.
- Стан дзвінка пишеться в `calls` при кожній зміні (`store/calls.ts`), на старті `service.restore()` повертає незавершені:
  `ringing` отримує таймер із залишком часу, прострочений завершується з `timeout`, `connected` просто лишається.
- Історія (`recents`) пишеться при завершенні за таблицею результатів із `signaling.md`; для ботів записів немає.
- Демо-боти (`bots/scenarios.ts`): Олена приймає через 3,5 с, Андрій не відповідає й очікування
  для нього 8 с, Support одразу `busy` (`expiresAt` коротший за 60 с), як у демо.
- Налаштування (`waiting`, `dnd`) лежать у `users.settings` (JSON) і змінюються командою `settings.update`; у `call.invite` порядок
  перевірок повністю відповідає `signaling.md`. `busy` через `dnd` чи `waiting: false` пише адресату тихий `missed` (`silent`).
- Другий вхідний: `waiting` не зберігається, а обчислюється (дзвінок `ringing`, а в адресата є `connected`), тому однаково
  працює в `hello.ok` і після перезапуску. `call.accept` з `action`, перемикання через `call.hold` з `hold: false` і
  `call.updated { waiting: false }`, коли перша розмова закінчилась, реалізовані в `calls/service.ts`.
- Виклик до адресата, який не в мережі, одразу завершується з `offline` (пуші з'являться на кроці 6). Адресат, який
  зайнятий чи не в мережі, не отримує ні `call.incoming`, ні `call.ended`.

## База даних
| Таблиця | Що зберігає |
|---|---|
| `sites` | сайти-господарі: `id`, назва, секрет, `allowed_origins`; окремий запис `demo` |
| `users` | ключ `(site_id, id)`, де `id` це E.164 у демо (а в демо-ботів `bot:olena`, `bot:andriy`, `bot:support`), ім'я, `disabled`, `is_bot`, `settings` (JSON: `waiting`, `dnd`) |
| `calls` | дзвінки: `id`, учасники, стан, `created_at`, `answered_at`, `ended_at`, `reason` |
| `recents` | історія: чий запис, `call_id`, співрозмовник, напрям, результат, `silent`, тривалість, `seen` |
| `push_subscriptions` | підписка Web Push на пристрій: `user_id`, `device_id`, дані підписки |

- Зараз у БД `sites`, `users` (`001_init.sql`), `calls` і `recents` (`002_calls.sql`); `push_subscriptions` з'явиться з кроком 6.
- Міграції простими SQL-файлами, що застосовуються за порядком при старті. Окремих ORM не беремо.
- `better-sqlite3` синхронний, що для одного інстансу прийнятно, а код простіший. Режим WAL увімкнений.
- Активні дзвінки пишемо в `calls` одразу (write-through) і читаємо при старті: так перезапуск чи деплой не губить
  дзвінки, що дзвонять, а таймери відновлюються за `expiresAt`. Саме медіа при цьому не переривається, бо воно йде через LiveKit.

## HTTP
| Ендпоінт | Для чого |
|---|---|
| `POST /demo/login` | `{ name, phone }` → JWT з `site: "demo"`. Номер нормалізується в E.164, той самий номер перезаписує ім'я |
| `POST /tokens` | бекенд сайту-господаря просить токен користувача. Автентифікація: `siteId` + секрет сайту. Тіло: `{ userId, name }` |
| `POST /livekit/webhook` | події LiveKit (`participant_left`) для правила `lost`. Підпис перевіряє `WebhookReceiver` |
| `GET /health` | для Fly.io |

CORS для `/demo/login` обмежений origin демо-сторінки. `/tokens` викликається лише з серверів сайтів, тож CORS не відкриваємо.

## Токени

### Токен користувача (JWT)
- Підпис HS256 секретом з `JWT_SECRET` (секрет Fly.io); у заголовку `kid` для ротації ключів.
- Claims: `sub` (userId), `sid` (siteId, для демо `demo`), `name`, `iat`, `exp`, `jti`.
- Термін життя 30 хв, як і в прототипі демо. За 60 с до кінця сервер надсилає `token.expiring`,
  віджет оновлює токен через хост (`token:expired` → `setToken` → `auth.refresh`).
- Токен із `sid: demo` працює лише з демо-користувачами: сервер перевіряє, що `users.site_id` збігається з `sid`.
- **Відкликання.** Окремого списку відкликаних немає: короткий `exp` і перевірка `users.disabled` при `hello` та
  `auth.refresh` закривають потребу. Заблокований користувач втрачає доступ не пізніше ніж за 30 хв, а поточне
  з'єднання сервер закриває одразу кодом `4403`.

### Токен LiveKit
Видає сервер під час `call.connected` (і в `hello.ok` для `connected` дзвінків):
- кімната `callId`, `identity` = `userId:deviceId`, термін життя 1 год;
- права: підключитись, публікувати, підписуватись; без `canPublishData`;
- токен отримує лише пристрій, який бере участь у розмові (той, з якого дзвонили, і той, що відповів). Інші пристрої
  користувача бачать дзвінок без `livekit`, щоб два пристрої не ділили одну ідентичність і не виштовхували один одного;
- дзвінки з демо-ботами без токенів: у кімнату зайти нікому, а `lost` для них вимкнено.
Підписуємо самі (HMAC-JWT у `livekit/index.ts`), а не через `livekit-server-sdk`: SDK підписує асинхронно, а токен
потрібен усередині синхронної логіки дзвінків. Формат перевіряє тест через `TokenVerifier` із SDK. Сам SDK
використовується для вебхуків (`WebhookReceiver`) і REST (`RoomServiceClient`: закрити кімнату, список учасників).
Ключі й URL LiveKit Cloud у `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`: задаються разом, у `production`
обов'язкові, а без них (лише розробка) дзвінки працюють без медіа.

### Вебхук LiveKit і правило `lost`
- `POST /livekit/webhook` з `Content-Type: application/webhook+json`; тіло читається «сирим», підпис перевіряє `WebhookReceiver`
  (неправильний чи відсутній дає `401`). Ендпоінт є лише коли LiveKit налаштовано. У панелі LiveKit Cloud вебхук спрямовується на
  `https://<застосунок>.fly.dev/livekit/webhook`.
- Сервіс рахує, хто з двох очікуваних ідентичностей (`userId:deviceId` того, хто дзвонив, і того, що відповів) зараз у кімнаті.
  Відлік 30 с до `lost` стартує при `call.connected` (учасники мають зайти) і щоразу, коли когось бракує; скасовується,
  коли в кімнаті обоє. `room_finished` обнуляє список.
- Завершений дзвінок закриває кімнату (`deleteRoom`, помилка лише логується), щоб медіа не жило без розмови.
- Після перезапуску `restoreMedia()` питає LiveKit про учасників кімнат відновлених розмов. Якщо LiveKit недоступний, дзвінки
  не завершуються, лише логується попередження.

## Конфігурація
Змінні середовища (Fly.io secrets): `JWT_SECRET`, `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`,
`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `LOG_LEVEL` (за замовчуванням `info`), `DB_PATH` (за замовчуванням `/data/dialer.db`), `DEMO_ORIGIN`, `PORT`.
У репозиторії лежить лише `.env.example` без значень.

## Розгортання на Fly.io
- Один застосунок, **одна машина** з томом `/data` для SQLite. Кілька машин не можна: БД і стан дзвінків локальні.
- `auto_stop_machines = false` і `min_machines_running = 1`: інакше машина засне й вхідні не дійдуть.
- Регіон ближче до користувачів (наприклад, `waw` чи `fra`). Перевірка здоров'я `GET /health`.
- Fly.io тримає WebSocket-з'єднання, але деплой їх розриває: клієнти перепідключаються за паузами з `signaling.md`,
  а дзвінки відновлюються з БД.
- Вебхук LiveKit Cloud спрямований на публічну адресу `https://<застосунок>.fly.dev/livekit/webhook`.
- Файли: `apps/server/Dockerfile` (збірка з кореня, `pnpm install --prod`, запуск через `tsx` без компіляції), `apps/server/fly.toml`,
  `.dockerignore` у корені. `DEMO_ORIGIN` у `fly.toml` це origin GitHub Pages (`https://grigoriychernish.github.io`).
- Резервні копії: щоденні знімки тому Fly.io. Litestream не використовуємо: для демо й одного інстансу знімків достатньо.
- Збірка: Dockerfile у `apps/server`, контекст від кореня моноrepo, щоб потрапив `packages/shared`.

### Перший деплой (вручну)
Потрібні `flyctl` і акаунт Fly.io. Назва застосунку `dialer-server` у `fly.toml` це заглушка: якщо зайнята, замініть.
```bash
fly apps create dialer-server
fly volumes create dialer_data --size 1 --region waw --app dialer-server   # том для SQLite
fly secrets set --app dialer-server \
  JWT_SECRET="$(openssl rand -hex 32)" \
  LIVEKIT_URL="wss://<проєкт>.livekit.cloud" \
  LIVEKIT_API_KEY="…" LIVEKIT_API_SECRET="…"
fly deploy --config apps/server/fly.toml --dockerfile apps/server/Dockerfile --ha=false .   # з кореня репозиторію
curl https://dialer-server.fly.dev/health
```
`--ha=false` потрібен, щоб Fly не створив другу машину: кілька інстансів не підтримуються. Далі в панелі LiveKit Cloud
додайте вебхук `https://dialer-server.fly.dev/livekit/webhook`.

### Автодеплой (GitHub Actions)
`.github/workflows/deploy.yml` запускається, коли CI на `dev` завершився успішно після пушу (і вручну через `workflow_dispatch`):
`flyctl deploy --remote-only --ha=false` (образ збирає Fly.io), потім перевіряє `GET /health`.
- Деплой рве WebSocket-з'єднання, тож він іде, лише якщо з минулого успішного деплою змінились файли сервера:
  `apps/server`, `packages/shared`, кореневі `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.dockerignore`
  або сам workflow. Зміни дизайну, документації чи `apps/web` деплой не запускають. Ручний запуск деплоїть завжди.
- Деплої йдуть по черзі (`concurrency: fly-deploy`) і не перериваються новим пушем.
- Потрібен секрет репозиторію `FLY_API_TOKEN`: `fly tokens create deploy --app dialer-server`, далі GitHub → Settings → Secrets → Actions.
  Без секрету workflow завершується успішно й нічого не деплоїть, тож до першого ручного деплою він не заважає.

### Що перевірено без Fly.io
Образ зібрано локально в Docker для `linux/amd64` (як на Fly.io) і запущено з томом `/data`: `/health` відповідає `{"ok":true}`,
`POST /demo/login` видає токен, вебхук без підпису дає `401`, SQLite створюється на томі, `SIGTERM` зупиняє сервер коректно.
У production сервер не стартує без `JWT_SECRET` і без змінних `LIVEKIT_*`, тож секрети треба задати до першого деплою.
Сам деплой на Fly.io ще не перевірено: потрібні акаунт і `flyctl`.

## Тести
- **Юніт (Vitest).** `calls/`: таблиця правил `call.invite`, таймери на фейковому часі, машина станів, `waiting`, `dnd`.
- **Інтеграційні.** Сервер у процесі й два справжні WebSocket-клієнти: успішний дзвінок, `busy`, `timeout`,
  два пристрої адресата, `waiting` з обома діями, `dnd`, `settings.update`, перепідключення з `calls`.
  LiveKit замінено заглушкою, яка повертає фіксований токен.

## Порядок робіт
1. ✅ Каркас моноrepo: `pnpm-workspace.yaml`, `packages/shared` з типами `signaling.ts`, порожній `apps/server`.
2. ✅ Демо-вхід (`POST /demo/login`), JWT, присутність, `hello` / `hello.ok`, контакти.
3. ✅ Дзвінок без медіа: `call.invite`/`accept`/`reject`/`cancel`/`hangup`/`hold`, таймаут, історія, боти, відновлення після перезапуску.
4. ✅ `waiting`, `dnd`, `settings`.
5. ✅ LiveKit: токени кімнат, вебхук, правило `lost`.
6. ⏸ Web Push і `POST /tokens` для справжніх сайтів-господарів: поки пропущено (пункт 15 беклогу).
7. ✅ Розгортання на Fly.io: `Dockerfile`, `fly.toml`, автодеплой `.github/workflows/deploy.yml` (перший деплой робиться вручну, див. «Розгортання на Fly.io»).

## Логи
Бібліотека `pino`, JSON у stdout (Fly.io збирає їх сам, `fly logs`).
- Один кореневий логер в `main.ts`, у модулі передаємо дочірні (`logger.child({ module: 'calls' })`).
- До кожного запису з'єднання додаємо `connId`, `userId`, `deviceId`, до запису про дзвінок `callId`, щоб дзвінок можна було простежити наскрізь.
- Рівні: `error` збої сервера й LiveKit (`reason: 'error'`), `warn` відхилені кадри, невалідний токен, `rate_limited`,
  `info` життєвий цикл дзвінка й підключення, `debug` окремі кадри (вимкнено в продакшені, рівень із `LOG_LEVEL`).
- У логи не потрапляють токени (JWT, LiveKit), секрети, дані пуш-підписок і тіла кадрів у `info`. Номери телефонів пишемо як є лише
  для демо, для справжніх сайтів-господарів маскуємо (останні 4 цифри).
- Локально `pino-pretty` для читабельного виводу (лише в `devDependencies`).

## Відкриті питання
- Метрики (кількість з'єднань, дзвінків, помилок): поки лише логи.
