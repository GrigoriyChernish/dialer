# Локальний запуск

Усі команди виконуються з кореня репозиторію, якщо не сказано інше.

## Демо (`index.html`)

Збірки немає, потрібен лише статичний сервер (камера працює тільки на `localhost` чи HTTPS):

```bash
python3 -m http.server 8080
```

- прототип: <http://localhost:8080>
- сторінка демо з входом і віджетом: <http://localhost:8080/demo/>

- демо зі справжнім сервером: <http://localhost:8080/demo/?server=http://localhost:8787> (спершу запустіть сервер, див. нижче).
  Сесія в такому режимі своя в кожній вкладці, тож у двох вкладках можна бути двома різними людьми й дзвонити одне одному
  через сигналізацію. Аудіо йде через LiveKit, тож у `apps/server/.env` потрібні `LIVEKIT_*` (без них розмова буде без звуку), а браузер має дозволити мікрофон; відео співрозмовника ще не показується. Без `?server=` усе імітується в браузері.

- Vue-віджет (`apps/web`): `corepack pnpm --filter @dialer/web dev` піднімає його на <http://localhost:5173>. Щоб побачити його в демо, додайте
  параметр `widget`: <http://localhost:8080/demo/?server=http://localhost:8787&widget=http://localhost:5173/>. Тести й типи: `pnpm --filter @dialer/web test` та `typecheck`.

Порт `8080` збігається з `DEMO_ORIGIN` у `apps/server/.env.example`, тож CORS сервера пропустить демо.

## Сервер (`apps/server`)

Потрібні Node 22 і pnpm (версія в `packageManager`). Якщо `pnpm` не встановлено, використовуйте `corepack pnpm`.

```bash
corepack pnpm install
cp apps/server/.env.example apps/server/.env
```

У `apps/server/.env` задайте `JWT_SECRET`, наприклад згенерований командою `openssl rand -hex 32`.
Без нього сервер підставляє ключ для розробки й попереджає про це в логах. `LIVEKIT_*` можна не заповнювати:
дзвінки працюватимуть без медіа.

```bash
cd apps/server
corepack pnpm dev
```

Сервер слухає <http://localhost:8787>, перевірка: `curl localhost:8787/health` повертає `{"ok":true}`.
`pnpm dev` перезапускається при змінах у коді, але не при змінах `.env`: після правки перезапустіть процес.

Тести й перевірка типів: `pnpm test` та `pnpm typecheck` у `apps/server`.
