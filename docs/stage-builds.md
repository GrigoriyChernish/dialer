# Стейд-збірки Android і десктопа

Стейд це збірки застосунків, які ходять на справжній сервер `https://dialer-chat-server.fly.dev` (Fly.io; поки це єдине середовище, тож воно ж стейд). Адреса сервера вшивається при збірці змінною `VITE_SERVER_URL`. Android збирається як release (підписаний, зменшений R8, без `usesCleartextTraffic`), десктоп як macOS `.app`/`.dmg` без нотаризації.

## Одноразова підготовка

1. **Keystore для Android** (поза репозиторієм; втрата файлу чи пароля означає, що встановлений застосунок не оновити, лише перевстановити):

   ```bash
   keytool -genkeypair -v -keystore ~/dialer-stage.keystore -alias dialer -keyalg RSA -keysize 2048 -validity 10000
   ```

   `keytool` спитає пароль і дані власника.

2. **Шлях і паролі для Gradle** у `~/.gradle/gradle.properties` (файл не в репозиторії):

   ```properties
   DIALER_KEYSTORE=/Users/<ім'я>/dialer-stage.keystore
   DIALER_KEYSTORE_PASSWORD=<пароль keystore>
   DIALER_KEY_ALIAS=dialer
   DIALER_KEY_PASSWORD=<пароль ключа>
   ```

   Без цих змінних release збирається непідписаним (`app-universal-release-unsigned.apk`) і не встановиться.

3. **Ключ FCM на Fly.io** (сервер на Fly не бачить локальних файлів, тож ключ сервісного акаунта Firebase задається вмістом):

   ```bash
   fly secrets set FCM_SERVICE_ACCOUNT_JSON="$(cat ~/dialer-fcm.json)" --app dialer-chat-server
   ```

   Зміна секрету перезапускає машину. Код читання ключа з `FCM_SERVICE_ACCOUNT_JSON` має бути вже на Fly (автодеплой після пуша в `dev`, [backend.md](backend.md#автодеплой-github-actions)); без нього сервер відповість на `push.subscribe` з `fcmToken` помилкою `bad_request`.

4. **`google-services.json`** проєкту Firebase для пакета `com.dialer.app` у `apps/mobile/src-tauri/gen/android/app/` (у git не потрапляє, [local-development.md](local-development.md)).

## Збірка

Змінні Android SDK мають бути в середовищі (`JAVA_HOME`, `ANDROID_HOME`, `ANDROID_NDK_HOME`, `NDK_HOME`, див. `~/.zshrc`).

```bash
corepack pnpm --filter @dialer/mobile stage:android
```

APK: `apps/mobile/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`. Встановлення: `adb install -r <файл>` ([підключення по Wi-Fi](local-development.md)).

```bash
corepack pnpm --filter @dialer/mobile stage:desktop
```

`.app` і `.dmg`: `apps/mobile/src-tauri/target/release/bundle/`. Без нотаризації macOS показує попередження Gatekeeper: відкривати через контекстне меню → «Відкрити» або `xattr -dr com.apple.quarantine <застосунок>.app`.

## Перевірка

1. Увійти в застосунку (код входу ще останні 4 цифри номера, беклог 10).
2. Із браузера (`https://grigoriychernish.github.io/…`, з тим самим сервером) подзвонити на пристрій із закритим застосунком: сповіщення `CallStyle` і мелодія на Android, міні-вікно на macOS.
3. У логах Fly (`fly logs --app dialer-chat-server`) видно підключення пристрою; FCM-підписка з'являється після входу.

## Що ще не зроблено

Нотаризація macOS, Windows, `versionCode`/`versionName` за релізами, Play Market (беклог 47).
