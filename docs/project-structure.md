# Структура проєкту

Як організовано репозиторій: що вже є і куди додавати нові частини.

## Дерево
```
dialer/
  AGENTS.md          # інструкції для агентів
  CLAUDE.md          # підключає AGENTS.md для Claude Code
  .claude/           # налаштування Claude Code: launch.json, скіли
    skills/pen-dev/  #   скіл pen.dev для роботи з design/dialer.pen (копія з Pen.app)
    skills/vue-*/    #   скіли Vue 3, Pinia, Router, тестів і налагодження з vuejs-ai/skills (MIT)
    skills/fastify-best-practices/, node/, typescript-magician/  #   скіли бекенду й TypeScript з mcollina/skills (MIT)
  README.md          # що це за проєкт і як запустити
  index.html         # клікабельне демо інтерфейсу, воно ж прототип віджета (є)
  demo/              # сторінка демо з входом і вбудованим прототипом віджета (є)
    index.html       #   вхід за ім'ям і номером, «бекенд» імітується в localStorage
    embed.js         #   імітація завантажувача: плаваюча кнопка й iframe з ../index.html
  docs/              # документація (є)
    README.md        #   зміст
    architecture.md  #   цільова архітектура
    backend.md       #   стек і пристрій сервера
    components.md    #   каталог Vue-компонентів
    demo.md          #   як влаштоване демо
    design-system.md #   кольори, типографіка, теми
    project-structure.md
    signaling.md     #   контракт WebSocket
  work/              # робочі матеріали команди й агентів (є)
    backlog/         #   беклог задач
    changelog/       #   ченджлог, файл на день: YYYY-MM-DD.md
  package.json       # корінь pnpm workspaces: скрипти `typecheck` тощо (є)
  pnpm-workspace.yaml
  tsconfig.base.json # спільні налаштування TypeScript
  apps/
    server/          # бекенд: Node + TypeScript, Fastify + ws + SQLite, LiveKit; Dockerfile і fly.toml (є), див. backend.md
  packages/
    shared/          # спільні типи й константи сигналізації, `src/signaling.ts` (є)
  apps/web/          # фронтенд: віджет на Vue 3 (Vite, Tailwind 4, Pinia): дзвінок через сервер і LiveKit; екрани лише контакти й дзвінок
  .dockerignore      # що не потрапляє в образ сервера
  .github/workflows/ # CI: pages.yml публікує прототипи на GitHub Pages, ci.yml перевіряє типи й тести, а після зеленої перевірки в dev деплоїть сервер на Fly.io; далі лінт, збірка web/
```

## Правила
- **Корінь** містить лише службові файли й папки верхнього рівня. Код застосунку в корінь не кладемо.
- **`docs/`** — довготривала документація: як усе влаштовано й чому.
- **`work/`** — робочий процес: що зробити (беклог) і що зроблено (ченджлог).
- **`web/`** — фронтенд зі своїм `package.json` і `README.md` з командами запуску.
  Внутрішня структура описана в [architecture.md](architecture.md#структура-папок).
- **Бекенд** (`apps/server`) і спільні типи сигналізації (`packages/shared`) живуть у цьому ж репозиторії.
- **Workspaces.** Залежності ставимо з кореня (`pnpm install`), перевірка типів усіх пакетів: `pnpm typecheck`.
  Пакет `@dialer/shared` віддається як TypeScript-код (без збірки), його імпортують Vite і `tsx`.
- **Прототипи** `index.html` і `demo/` лишаються, поки не з'явиться `web/`. Потім сторінка демо переїде в `web/demo/`.

## Рішення
- **Монорепозиторій.** Бекенд живе в цьому репозиторії поруч із фронтендом. Цільова структура: `apps/web`, `apps/server`,
  `packages/shared` (типи й константи сигналізації), керування через pnpm workspaces. Поточна папка `web/` переїде в `apps/web`
  під час міграції (пункт 12 беклогу). Контракт подій описано в [signaling.md](signaling.md).
- **Типи сигналізації лише на TypeScript** у `packages/shared`, без схем. Сервер один інстанс; масштабування пізніше.
