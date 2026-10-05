# Стейд-збірки Android і десктопа

Стейд це збірки застосунків, які ходять на справжній сервер `https://dialer-chat-server.fly.dev` (Fly.io; поки це єдине середовище, тож воно ж стейд). Адреса сервера вшивається при збірці змінною `VITE_SERVER_URL`. Android збирається як release (підписаний, зменшений R8, без `usesCleartextTraffic`), десктоп як macOS `.app`/`.dmg` без нотаризації.

## Одноразова підготовка

1. **Keystore для Android** (поза репозиторієм; втрата файлу чи пароля означає, що встановлений застосунок не оновити, лише перевстановити):

   ```bash
   mkdir -p ~/.gradle/dialer
   keytool -genkeypair -v -keystore ~/.gradle/dialer/dialer-stage.keystore -alias dialer -keyalg RSA -keysize 2048 -validity 10000
   ```

   `keytool` спитає пароль і дані власника. Ключ зберігається у `~/.gradle/dialer/`, щоб не засмічувати домашній каталог.

2. **Шлях і паролі для Gradle** у `~/.gradle/gradle.properties` (файл не в репозиторії):

   ```properties
   DIALER_KEYSTORE=/Users/<ім'я>/.gradle/dialer/dialer-stage.keystore
   DIALER_KEYSTORE_PASSWORD=<пароль keystore>
   DIALER_KEY_ALIAS=dialer
   DIALER_KEY_PASSWORD=<пароль ключа>
   ```

   Без цих змінних release збирається непідписаним (`app-universal-release-unsigned.apk`) і не встановиться.

3. **Ключ FCM на Fly.io** (сервер на Fly не бачить локальних файлів, тож ключ сервісного акаунта Firebase задається вмістом):

   ```bash
   fly secrets set FCM_SERVICE_ACCOUNT_JSON="$(cat ~/.gradle/dialer/dialer-fcm.json)" --app dialer-chat-server
   ```

   Зміна секрету перезапускає машину. Код читання ключа з `FCM_SERVICE_ACCOUNT_JSON` має бути вже на Fly (автодеплой після пуша в `dev`, [backend.md](backend.md#автодеплой-github-actions)); без нього сервер відповість на `push.subscribe` з `fcmToken` помилкою `bad_request`.

4. **`google-services.json`** проєкту Firebase для пакета `com.dialer.app` у `apps/mobile/src-tauri/gen/android/app/` (у git не потрапляє, [local-development.md](local-development.md)).

5. **`apps/web/.env.stage`** з адресою сервера на Fly.io (файл у `.gitignore`, [local-development.md](local-development.md)):

   ```env
   VITE_SERVER_URL=https://dialer-chat-server.fly.dev
   ```

## Збірка

Змінні Android SDK мають бути в середовищі (`JAVA_HOME`, `ANDROID_HOME`, `ANDROID_NDK_HOME`, `NDK_HOME`, див. `~/.zshrc`).

Стейдж-збірки використовують конфігурацію назви `Dialer Stage` (`apps/mobile/src-tauri/tauri.stage.conf.json`), що передається прапорцем `-c` у скриптах `stage:desktop` та `stage:android`.

```bash
corepack pnpm --filter @dialer/mobile stage:android
```

APK: `apps/mobile/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`. Встановлення: `adb install -r <файл>` ([підключення по Wi-Fi](local-development.md)).

```bash
corepack pnpm --filter @dialer/mobile stage:desktop
```

`.app` і `.dmg`: `apps/mobile/src-tauri/target/release/bundle/` (`Dialer Stage.app`). Без нотаризації macOS показує попередження Gatekeeper: відкривати через контекстне меню → «Відкрити» або `xattr -dr com.apple.quarantine "apps/mobile/src-tauri/target/release/bundle/macos/Dialer Stage.app"`.

## Роздача користувачам

Користувач, що увійшов у веб-версію, качає збірки в Налаштуваннях → «Застосунки» (у Tauri-застосунку розділу немає). Файли лежать у приватному бакеті Tigris (S3-сумісне сховище Fly.io): один (останній) файл на платформу `android/dialer.apk`, `macos/dialer.dmg` і `manifest.json` (`{ android: { version, size, sha256, updatedAt }, macos: {…} }`). Сервер віддає список (`GET /downloads`) і підписане посилання на 60 с (`POST /downloads/:platform/link`, AWS SigV4 на `node:crypto`), файл браузер тягне напряму з Tigris; без входу посилань немає ([backend.md](backend.md#http)).

Одноразово:

1. Бакет для сервера: `fly storage create --app dialer-chat-server` (додає секрети `AWS_*` і `BUCKET_NAME`, сервер сам їх підхопить; машина перезапуститься).
2. Ключі для публікації з Mac: `brew install awscli` і файл `~/.gradle/dialer/tigris.env` (поза репозиторієм; ключі взяти з `fly storage dashboard` чи створити окремі) із рядками `BUCKET_NAME=…`, `AWS_ACCESS_KEY_ID=…`, `AWS_SECRET_ACCESS_KEY=…`, `AWS_ENDPOINT_URL_S3=https://fly.storage.tigris.dev`, `AWS_REGION=auto`.

Далі `stage:android` і `stage:desktop` у кінці збірки самі запускають `scripts/publish-build.sh`: вантажать файл у бакет і оновлюють `manifest.json` (версія з `tauri.conf.json`, `sha256`, розмір). Без ключів чи `aws` крок пропускається з повідомленням, збірка не падає. Вручну: `scripts/publish-build.sh <android|macos> <файл>`.

Підказки користувачам: Android просить дозволити встановлення з браузера («Невідомі джерела»), macOS без нотаризації відкривається через контекстне меню → «Відкрити» (беклог 47).

## Перевірка

1. Увійти в застосунку (код входу ще останні 4 цифри номера, беклог 10).
2. Із браузера (`https://grigoriychernish.github.io/…`, з тим самим сервером) подзвонити на пристрій із закритим застосунком: сповіщення `CallStyle` і мелодія на Android, міні-вікно на macOS.
3. У логах Fly (`fly logs --app dialer-chat-server`) видно підключення пристрою; FCM-підписка з'являється після входу.
4. Завантаження: після `stage:*` у веб-версії Налаштування → «Застосунки» показують версію й розмір, тап качає файл; без входу `GET /downloads` дає `401`.

## Що ще не зроблено

Нотаризація macOS, Windows, `versionCode`/`versionName` за релізами, Play Market (беклог 47).
