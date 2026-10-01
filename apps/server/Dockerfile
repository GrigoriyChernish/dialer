# Збірка з кореня репозиторію (потрібен packages/shared):
#   docker build -f apps/server/Dockerfile -t dialer-server .
FROM node:22-bookworm-slim AS deps
WORKDIR /app
# інструменти на випадок, якщо для better-sqlite3 немає готового бінарника
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile --prod --filter @dialer/server...

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app/node_modules node_modules
COPY --from=deps /app/apps/server/node_modules apps/server/node_modules
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server/package.json apps/server/tsconfig.json apps/server/
COPY apps/server/migrations apps/server/migrations
COPY apps/server/src apps/server/src
WORKDIR /app/apps/server
EXPOSE 8080
CMD ["./node_modules/.bin/tsx", "src/main.ts"]
