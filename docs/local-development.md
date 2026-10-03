# Локальний запуск

Усі команди виконуються з кореня репозиторію, якщо не сказано інше.

## Сторінка демо (`demo/`)

Збірки немає, потрібен лише статичний сервер (камера працює тільки на `localhost` чи HTTPS); віджет у ній це `apps/web`, його треба запустити окремо (нижче):

```bash
python3 -m http.server 8080
```

- сторінка демо з входом і віджетом: <http://localhost:8080/demo/>

- демо зі справжнім сервером: <http://localhost:8080/demo/?server=http://localhost:8787> (спершу запустіть сервер, див. нижче).
  Сесія в такому режимі своя в кожній вкладці, тож у двох вкладках можна бути двома різними людьми й дзвонити одне одному
  через сигналізацію. Аудіо йде через LiveKit, тож у `apps/server/.env` потрібні `LIVEKIT_*` (без них розмова буде без звуку), а браузер має дозволити мікрофон; відео співрозмовника ще не показується. Без `?server=` усе імітується в браузері.

- `apps/web`: `corepack pnpm --filter @dialer/web dev` піднімає його на <http://localhost:5173>.
  - <http://localhost:5173/> — застосунок із входом за номером (як на GitHub Pages). Запити `/auth/*` і `/ws` Vite проксіює на сервер
    `:8787`, тож CORS для `:5173` не потрібен. Код входу — останні 4 цифри номера.
  - Віджет у демо: типово береться з <http://localhost:5173/widget.html>, тож достатньо <http://localhost:8080/demo/?server=http://localhost:8787> (інша адреса: параметр `widget`). Тести й типи: `pnpm --filter @dialer/web test` та `typecheck`.

Порт `8080` збігається з `DEMO_ORIGIN` у `apps/server/.env.example`, тож CORS сервера пропустить демо.

## Сервер (`apps/server`)

Потрібні Node 22 і pnpm (версія в `packageManager`). Якщо `pnpm` не встановлено, використовуйте `corepack pnpm`.

```bash
corepack pnpm install
cp apps/server/.env.example apps/server/.env
```

У `apps/server/.env` задайте `JWT_SECRET`, наприклад згенерований командою `openssl rand -hex 32`.
Без нього сервер підставляє ключ для розробки й попереджає про це в логах. `LIVEKIT_*` можна не заповнювати:
дзвінки працюватимуть без медіа. Сповіщення про дзвінки (Web Push) вмикаються лише з ключами VAPID: `npx web-push generate-vapid-keys` і `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT=mailto:…` у `.env`; без них рядка «Сповіщення про дзвінки» в Налаштуваннях немає. Сервіс-воркер працює на `localhost` без HTTPS.

```bash
cd apps/server
corepack pnpm dev
```

Сервер слухає <http://localhost:8787>, перевірка: `curl localhost:8787/health` повертає `{"ok":true}`.
`pnpm dev` перезапускається при змінах у коді, але не при змінах `.env`: після правки перезапустіть процес.

Тести й перевірка типів: `pnpm test` та `pnpm typecheck` у `apps/server`.
