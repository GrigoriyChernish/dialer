# Дзвонілка: демо фіч

Демо аудіо/відеодзвінків: список контактів, історія, вихідний і вхідний дзвінок, «зайнято», «без відповіді», пропущений дзвінок,
екран розмови з утриманням, мікрофоном, камерою і слабким сигналом, PWA зі сповіщеннями про дзвінки (Web Push, Android). Застосунок і віджет це Vue-проєкт `apps/web`, бекенд
(сигналізація, LiveKit) це `apps/server`, див. [`docs/backend.md`](docs/backend.md); зміст документації в [`docs/README.md`](docs/README.md).
Вигляд задає `design/dialer.pen`.

## Запуск

Повна інструкція в [`docs/local-development.md`](docs/local-development.md). Коротко: запустіть сервер (`apps/server`) і застосунок
(`corepack pnpm --filter @dialer/web dev`, <http://localhost:5173>).

Сторінка демо з входом і віджетом у кутку (потрібен статичний сервер і запущений `apps/web`):

```bash
python3 -m http.server 8080
```

<http://localhost:8080/demo/>.
Щоб подзвонити «іншому користувачу», відкрийте її ще в одній вкладці й увійдіть з іншим номером.
Зі справжнім сервером сигналізації (спершу запустіть `apps/server`): <http://localhost:8080/demo/?server=http://localhost:8787>.

Запуск сервера й налаштування `.env`: [`docs/local-development.md`](docs/local-development.md).

## Мобільний застосунок (`apps/mobile`)

Оболонка на Tauri 2 з інтерфейсом `apps/web` та дозволами WebRTC:

- **Запуск у вікні на комп'ютері (macOS/десктоп):**
  ```bash
  corepack pnpm --filter @dialer/mobile dev
  ```
  Відкриває нативне вікно з пропорціями екрана телефону (390 × 844) та гарячим оновленням (HMR).

- **Збірка Android APK:**
  ```bash
  corepack pnpm --filter @dialer/mobile exec tauri android build -d --apk -t aarch64
  ```
  Готовий APK: `apps/mobile/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`.

- **Встановлення на телефон через USB (`adb`):**
  ```bash
  adb install apps/mobile/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
  ```

Онлайн: <https://grigoriychernish.github.io/dialer/> (публікується з гілки `dev`).

