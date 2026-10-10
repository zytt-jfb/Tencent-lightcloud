FROM node:20-alpine

RUN apk add --no-cache python3 make g++ \
  && npm install -g pnpm@9.15.0

WORKDIR /app
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/shared-types/package.json packages/shared-types/package.json
COPY packages/shared-constants/package.json packages/shared-constants/package.json
COPY apps/api/package.json apps/api/package.json
RUN pnpm install --frozen-lockfile --prefer-offline

COPY packages/shared-types packages/shared-types
COPY packages/shared-constants packages/shared-constants
COPY apps/api apps/api
COPY scripts scripts

CMD ["node", "scripts/db/migrate.mjs", "up"]
