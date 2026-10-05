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

## Мобільний застосунок (`apps/mobile`)

Застосунок на базі Tauri 2, що пакує інтерфейс `apps/web` у WebView з підтримкою WebRTC:

- **Запуск у вікні на комп'ютері:**

  ```bash
  corepack pnpm --filter @dialer/mobile dev
  ```

  Автоматично піднімає Vite dev-сервер та відкриває нативне десктопне вікно з пропорціями екрана телефону (390 × 844 px).

- **Збірка Debug APK (Android):**

  ```bash
  corepack pnpm --filter @dialer/mobile exec tauri android build -d --apk -t aarch64
  ```

  Файл APK створюється у папці `apps/mobile/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`.

- **Підключення телефона по Wi-Fi (`adb pair`).** Android 11+, телефон і Mac в одній Wi-Fi мережі:
  1. На телефоні: Налаштування → Параметри розробника → **Бездротове налагодження** → увімкнути.
  2. Натиснути **«Підключити пристрій за допомогою коду підключення»**: з'являться IP:порт і шестизначний код.
  3. Спарувати (один раз, порт і код діють, поки відкрите це вікно):

     ```bash
     adb pair <IP>:<ПОРТ_ПАРУВАННЯ>
     ```

     і ввести код. Команда `adb connect` на порт парування відмовить: це нормально.
  4. Перевірити, що пристрій видно (він підхоплюється сам через mDNS, `…_adb-tls-connect._tcp`):

     ```bash
     adb devices -l
     ```

     Якщо не з'явився, на головному екрані «Бездротового налагодження» взяти інший IP:порт і виконати `adb connect <IP>:<ПОРТ>`.
  5. Встановити збірку: `adb install -r <шлях до app-universal-debug.apk>`. Змінні Android SDK (`JAVA_HOME`, `ANDROID_HOME`, `ANDROID_NDK_HOME`, `NDK_HOME`) мають бути в середовищі, інакше `tauri android build` не знайде SDK.

- **Встановлення на реальний телефон через USB:**
  1. Увімкніть «Налагодження по USB» в налаштуваннях розробника Android.
  2. Виконайте:

     ```bash
     adb install apps/mobile/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
     ```

  3. Для зв'язку з локальним сервером на комп'ютері задайте адресу при збірці: `VITE_SERVER_URL=http://<IP_КОМП'ЮТЕРА>:8787` перед командою збірки (пристрій і ПК мають бути в одній Wi-Fi мережі). Без неї застосунок звертається до `localhost`, тобто до самого телефону.

- **Завантаження APK з телефона:** запустіть сервер із `DEV_APK_PATH=apps/mobile/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`, тоді файл доступний за `http://<IP_КОМП'ЮТЕРА>:8787/dialer.apk`. Без змінної маршруту немає, на Fly її не задаємо. Копію APK у `apps/web/public/` не кладемо (`.gitignore`).

- **Push на Android (FCM).** Для вхідних на закритий застосунок потрібен Firebase-проєкт: `google-services.json` для пакета `com.dialer.app` кладемо в `apps/mobile/src-tauri/gen/android/app/` (у git не потрапляє), а сервер запускаємо з `FCM_SERVICE_ACCOUNT_FILE=<шлях до JSON-ключа сервісного акаунта>` (ключ зберігаємо поза репозиторієм). Без них усе працює, але без push у закритий застосунок. Деталі: [pwa-and-push.md](pwa-and-push.md#android-застосунок-tauri-callstyle-і-fcm).
