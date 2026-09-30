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

Залежності мінімальні: `ws`, `fastify`, `better-sqlite3`, `jose` (JWT), `livekit-server-sdk`, `web-push`, `pino`.

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

## База даних
| Таблиця | Що зберігає |
|---|---|
| `sites` | сайти-господарі: `id`, назва, секрет, `allowed_origins`; окремий запис `demo` |
| `users` | ключ `(site_id, id)`, де `id` це E.164 у демо (а в демо-ботів `bot:olena`, `bot:andriy`, `bot:support`), ім'я, `disabled`, `is_bot`, `settings` (JSON: `waiting`, `dnd`) |
| `calls` | дзвінки: `id`, учасники, стан, `created_at`, `answered_at`, `ended_at`, `reason` |
| `recents` | історія: чий запис, `call_id`, співрозмовник, напрям, результат, `silent`, тривалість, `seen` |
| `push_subscriptions` | підписка Web Push на пристрій: `user_id`, `device_id`, дані підписки |

- Зараз у БД лише `sites` і `users` (міграція `001_init.sql`), решта таблиць додається з кроками 3–6.
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
Видає сервер через `livekit-server-sdk` під час `call.connected` (і в `hello.ok` для `connected` дзвінків):
- кімната `callId`, `identity` = `userId:deviceId`, термін життя 1 год;
- права: підключитись, публікувати, підписуватись; без `canPublishData`.
Ключі й URL LiveKit Cloud у змінних середовища `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`.

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
- Резервні копії: щоденні знімки тому Fly.io. Litestream не використовуємо: для демо й одного інстансу знімків достатньо.
- Збірка: Dockerfile у `apps/server`, контекст від кореня моноrepo, щоб потрапив `packages/shared`.

## Тести
- **Юніт (Vitest).** `calls/`: таблиця правил `call.invite`, таймери на фейковому часі, машина станів, `waiting`, `dnd`.
- **Інтеграційні.** Сервер у процесі й два справжні WebSocket-клієнти: успішний дзвінок, `busy`, `timeout`,
  два пристрої адресата, `waiting` з обома діями, `dnd`, `settings.update`, перепідключення з `calls`.
  LiveKit замінено заглушкою, яка повертає фіксований токен.

## Порядок робіт
1. ✅ Каркас моноrepo: `pnpm-workspace.yaml`, `packages/shared` з типами `signaling.ts`, порожній `apps/server`.
2. ✅ Демо-вхід (`POST /demo/login`), JWT, присутність, `hello` / `hello.ok`, контакти.
3. Дзвінок без медіа: `call.invite`/`accept`/`reject`/`cancel`/`hangup`, таймаут, історія, боти.
4. `waiting`, `dnd`, `settings`.
5. LiveKit: токени кімнат, вебхук, правило `lost`.
6. Web Push і `POST /tokens` для справжніх сайтів-господарів.
7. Розгортання на Fly.io (можна раніше, після кроку 2, щоб віджет на Pages працював з живим сервером).

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
