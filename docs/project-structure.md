# Структура проєкту

Як організовано репозиторій: що вже є і куди додавати нові частини.

## Дерево

``` text
dialer/
  AGENTS.md          # інструкції для агентів
  CLAUDE.md          # підключає AGENTS.md для Claude Code
  .claude/           # налаштування Claude Code: launch.json, скіли
    skills/pen-dev/  #   скіл pen.dev для роботи з design/dialer.pen (копія з Pen.app)
    skills/vue-*/    #   скіли Vue 3, Pinia, Router, тестів і налагодження з vuejs-ai/skills (MIT)
    skills/fastify-best-practices/, node/, typescript-magician/  #   скіли бекенду й TypeScript з mcollina/skills (MIT)
  README.md          # що це за проєкт і як запустити
  demo/              # сторінка демо з входом і вбудованим віджетом apps/web (є)
    index.html       #   вхід за ім'ям і номером через `POST /demo/login` сервера (без сервера імітація в localStorage)
    embed.js         #   імітація завантажувача: плаваюча кнопка й iframe з віджетом apps/web
  docs/              # документація (є)
    README.md        #   зміст
    architecture.md  #   цільова архітектура
    backend.md       #   стек і пристрій сервера
    components.md    #   каталог Vue-компонентів
    demo.md          #   як влаштоване демо
    design-system.md #   кольори, типографіка, теми
    local-development.md # локальний запуск
    notifications.md #   пул сповіщень екрана розмови
    project-structure.md
    pwa-and-push.md  #   PWA і Web Push
    signaling.md     #   контракт WebSocket
  design/            # дизайн: dialer.pen (головний, лише через Pencil) і tokens.json (токени для перевірки коду)
  scripts/           # check-design-tokens.mjs (токени дизайну проти коду), make-icons.mjs (іконки PWA)
  work/              # робочі матеріали команди й агентів (є)
    backlog/         #   беклог задач (backlog.md), беклог UI/UX (uiux.md), план livekit-recommendations.md
    changelog/       #   ченджлог, файл на день: YYYY-MM-DD.md
  package.json       # корінь pnpm workspaces: скрипти `typecheck`, `test`, `lint`, `format`, `check:design` (є)
  eslint.config.js   # ESLint для apps, packages і scripts
  pnpm-workspace.yaml
  tsconfig.base.json # спільні налаштування TypeScript
  apps/
    mobile/          # Android/мобільна оболонка на Tauri 2: WebView з apps/web, нативні дозволи й сервіси дзвінків
    server/          # бекенд: Node + TypeScript, Fastify + ws + SQLite, LiveKit; Dockerfile і fly.toml (є), див. backend.md
  packages/
    shared/          # спільні типи й константи сигналізації, `src/signaling.ts` (є)
  apps/web/          # фронтенд на Vue 3 (Vite, Tailwind 4, Pinia): застосунок (index.html) і віджет (widget.html), дзвінок через сервер і LiveKit;
                     #   екрани: вхід, контакти, історія, пошук, налаштування, дзвінок; тести в tests/
                     #   public/ — маніфест PWA, іконки (їх генерує scripts/make-icons.mjs) і сервіс-воркер sw.js (Web Push)
  .dockerignore      # що не потрапляє в образ сервера
  .github/workflows/ # CI: pages.yml публікує прототипи на GitHub Pages, ci.yml перевіряє типи, токени дизайну й тести, а після зеленої перевірки в dev деплоїть сервер на Fly.io; лінт поки лише локально (`pnpm lint`)
```

## Правила

- **Корінь** містить лише службові файли й папки верхнього рівня. Код застосунку в корінь не кладемо.
- **`docs/`** — довготривала документація: як усе влаштовано й чому.
- **`work/`** — робочий процес: що зробити (беклог) і що зроблено (ченджлог).
- **`apps/web`** — фронтенд зі своїм `package.json`; команди запуску в [local-development.md](local-development.md).
  Внутрішня структура описана в [architecture.md](architecture.md#структура-папок).
- **Бекенд** (`apps/server`) і спільні типи сигналізації (`packages/shared`) живуть у цьому ж репозиторії.
- **Workspaces.** Залежності ставимо з кореня (`pnpm install`), перевірка типів усіх пакетів: `pnpm typecheck`.
  Пакет `@dialer/shared` віддається як TypeScript-код (без збірки), його імпортують Vite і `tsx`.
- **Сторінка демо** `demo/` лишається статичною (без збірки); прототип `index.html` видалено, віджет це `apps/web`.

## Рішення

- **Монорепозиторій.** Бекенд живе в цьому репозиторії поруч із фронтендом. Структура: `apps/web`, `apps/server`,
  `packages/shared` (типи й константи сигналізації), керування через pnpm workspaces. Контракт подій описано в [signaling.md](signaling.md).
- **Типи сигналізації лише на TypeScript** у `packages/shared`, без схем. Сервер один інстанс; масштабування пізніше.
