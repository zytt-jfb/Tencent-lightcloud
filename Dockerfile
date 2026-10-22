# Business reporting API - multi-stage Dockerfile (ECS / any Docker host)
FROM node:20 AS builder

# apt 索引与包缓存跨构建复用，避免每次重新下载 python3/make/g++
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pnpm-lock.yaml ./
COPY pnpm-workspace.yaml ./
COPY package.json ./
COPY packages/shared-types/package.json ./packages/shared-types/
COPY packages/shared-constants/package.json ./packages/shared-constants/
COPY apps/api/package.json ./apps/api/

RUN npm install -g pnpm@9 --registry=https://registry.npmmirror.com
# 国内镜像源：实测 registry.npmjs.org 仅 562KB/s，npmmirror 3335KB/s（快 6 倍）。
# pnpm install 需下载数百 MB 依赖，这是构建耗时从 8 分钟涨到 40+ 分钟的主因。
# lockfile 的 integrity 校验不受影响（镜像内容与官方一致）。
RUN pnpm config set registry https://registry.npmmirror.com
RUN pnpm config set script-shell /bin/sh

# pnpm store 挂载为构建缓存：依赖包跨构建复用，避免每次都从 registry 重新拉取。
# 这台构建机（2C/2G、swap 高的云主机）此前单次构建要 9~27 分钟，主要耗在这里。
RUN --mount=type=cache,target=/root/.local/share/pnpm/store,sharing=locked \
    pnpm install --frozen-lockfile --prefer-offline

COPY packages/shared-types ./packages/shared-types
COPY packages/shared-constants ./packages/shared-constants
COPY apps/api ./apps/api
COPY scripts ./scripts

# Remove local build artifacts from the Docker context before compiling.
RUN find packages apps/api -type f \( \
      -name '*.tsbuildinfo' -o \
      -name '*.js' -o \
      -name '*.d.ts' -o \
      -name '*.js.map' -o \
      -name '*.d.ts.map' \
    \) -delete && echo "CLEANUP: removed local build artifacts"

# 合并为单个 RUN：减少镜像层数与层间 I/O，总耗时低于三次独立 RUN
RUN pnpm --filter @biz-reporting/shared-types build \
 && pnpm --filter @biz-reporting/shared-constants build \
 && pnpm --filter @biz-reporting/api build
RUN pnpm deploy --filter=@biz-reporting/api /app/deploy

# 将 Ledger 迁移工具与迁移脚本打进镜像，使容器可在启动时执行增量迁移（022-025）。
# migrate.mjs 依赖 repo 相对布局：scripts/db/migrate.mjs -> ../../apps/api/migration。
# MIGRATION_APPROVED 在 entrypoint 内导出，避免改动云端被脱敏的 DB EnvParams。
RUN mkdir -p /app/deploy/scripts/db /app/deploy/apps/api \
  && cp /app/scripts/db/migrate.mjs /app/deploy/scripts/db/migrate.mjs \
  && cp /app/scripts/db/migration-checksums.json /app/deploy/scripts/db/migration-checksums.json \
  && cp -r /app/apps/api/migration /app/deploy/apps/api/migration \
  && cp /app/apps/api/package.json /app/deploy/apps/api/package.json \
  && printf '%s\n' \
    '#!/bin/sh' \
    'set -eu' \
    'export MIGRATION_APPROVED=true' \
    'MARKER=/tmp/biz-reporting-api/.migrated' \
    '' \
    'if [ ! -f "$MARKER" ]; then' \
    '  echo "[entrypoint] ledger migration up (idempotent)"' \
    '  node scripts/db/migrate.mjs up' \
    '  echo "[entrypoint] migration ok, writing marker $MARKER"' \
    '  mkdir -p /tmp/biz-reporting-api' \
    '  touch "$MARKER"' \
    'fi' \
    '' \
    'echo "[entrypoint] starting API server"' \
    'exec node dist/main.js' \
    > /app/deploy/entrypoint.sh \
  && chmod +x /app/deploy/entrypoint.sh

FROM node:20 AS runner

# E-06：非 root 运行（UID/GID 10001）；上传解析使用容器临时目录并在任务结束后删除。
RUN groupadd --gid 10001 app && useradd --uid 10001 --gid app --create-home --shell /usr/sbin/nologin app

WORKDIR /app
COPY --from=builder --chown=10001:10001 /app/deploy ./

# AI 本地库目录：容器以非 root（UID 10001）运行，挂卷时若宿主目录属主不对会写不进去。
# 这里先建好目录并交给 10001，宿主机侧由 biz-deploy.sh chown 对齐。
RUN mkdir -p /app/data/ai && chown -R 10001:10001 /app/data

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:${PORT:-3000}/api/health/live || exit 1

EXPOSE 3000
USER 10001
CMD ["/bin/sh", "/app/entrypoint.sh"]
