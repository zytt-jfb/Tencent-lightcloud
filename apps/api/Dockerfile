# Business reporting API - CloudBase Run Dockerfile
# E-06 注意：权威 Dockerfile = 仓库根 Dockerfile（B-02 确认线上 003 构建输入）。
# 本副本必须与根 Dockerfile 保持一致，修改任一处需同步另一处。
FROM node:20-alpine AS builder

RUN apk add --no-cache python3 make g++
SHELL ["/bin/ash", "-eo", "pipefail", "-c"]

WORKDIR /app

COPY pnpm-lock.yaml ./
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-constants/package.json ./packages/shared-constants/
COPY apps/api/package.json ./apps/api/

RUN npm install -g pnpm@9
RUN pnpm config set script-shell /bin/ash
RUN pnpm install --frozen-lockfile --prefer-offline

COPY packages/shared-types ./packages/shared-types
COPY packages/shared-constants ./packages/shared-constants
COPY apps/api ./apps/api

# Remove local build artifacts from the Docker context before compiling.
RUN find packages apps/api -type f \( \
      -name '*.tsbuildinfo' -o \
      -name '*.js' -o \
      -name '*.d.ts' -o \
      -name '*.js.map' -o \
      -name '*.d.ts.map' \
    \) -delete && echo "CLEANUP: removed local build artifacts"

RUN pnpm --filter @biz-reporting/shared-types build
RUN pnpm --filter @biz-reporting/shared-constants build
RUN pnpm --filter @biz-reporting/api build
RUN pnpm deploy --filter=@biz-reporting/api /app/deploy

FROM node:20-alpine AS runner

# E-06：非 root 运行（UID/GID 10001）；上传解析使用容器临时目录并在任务结束后删除。
RUN addgroup -g 10001 app && adduser -u 10001 -G app -S app

WORKDIR /app
COPY --from=builder --chown=10001:10001 /app/deploy ./

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-3000}/api/health/live || exit 1

EXPOSE 3000
USER 10001
CMD ["node", "dist/main.js"]
