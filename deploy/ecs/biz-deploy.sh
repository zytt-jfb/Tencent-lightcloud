#!/usr/bin/env bash
#
# biz-deploy —— 极简更新脚本（替代原 biz-update）
# ---------------------------------------------------------------------------
# 设计原则：
#   1. 代码源改为 Gitee 仓库（国内可达），不再依赖连不上的 GitHub。
#   2. 部署配置以「HTTPS 版」为准：更新过程绝不破坏已配好的 HTTPS。
#   3. 证书(/etc/letsencrypt)、ACME 目录、MySQL 数据卷都在宿主机，
#      更新只重建镜像/容器，不触碰这些持久数据。
#   4. 带并发锁 + 安全闸门：任何异常即中止，绝不把线上站点搞挂。
# ---------------------------------------------------------------------------
set -Eeuo pipefail

REPO="https://gitee.com/lixm66/zy_data.git"
DEPLOY_DIR="/home/ubuntu/zy/zy_data"                     # Gitee 克隆目标（独立于原运行目录）
COMPOSE_DIR="$DEPLOY_DIR/deploy/ecs"
SRC_COMPOSE_DIR="/home/ubuntu/zy/Tencent-lightcloud-main/deploy/ecs"  # 原运行目录（仅用于首次复制 .env）
LOG="/var/log/biz-deploy.log"
LOCK="/var/run/biz-deploy.lock"

log() { echo "[$(date +'%F %T')] $*" | tee -a "$LOG"; }

# 用法：
#   bash biz-deploy.sh               在本机构建镜像后部署（默认）
#   bash biz-deploy.sh --pull-only   镜像已由 CI 构建并推送，本机只拉取
#                                    需同时提供 API_IMAGE / WEB_IMAGE 两个环境变量
PULL_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --pull-only) PULL_ONLY=1 ;;
    *) log "【中止】未知参数: $arg（仅支持 --pull-only）"; exit 1 ;;
  esac
done

# 并发锁：防止重叠执行导致竞态
exec 9>"$LOCK"
flock -n 9 || { echo "已有更新在运行，退出"; exit 1; }

# ---------- 1. 获取代码 ----------
if [ ! -d "$DEPLOY_DIR/.git" ]; then
  log "首次克隆仓库: $REPO"
  git clone "$REPO" "$DEPLOY_DIR" \
    || { log "【失败】克隆仓库出错：请检查 Gitee 可达性、仓库是否非空、是否需要凭证"; exit 1; }
else
  log "拉取最新代码 (git pull --ff-only)"
  git -C "$DEPLOY_DIR" pull --ff-only \
    || { log "【失败】pull 冲突（本地有未提交改动），请人工处理后再更新"; exit 1; }
fi

cd "$COMPOSE_DIR"

# ---------- 2. 安全闸门：HTTPS 配置必须存在 ----------
# 若 Gitee 里的 compose.yml 被人误改成不含 HTTPS 的版本，直接中止，
# 避免把正在运行的 443/证书配置覆盖掉导致网站挂。
if ! grep -q '443:443' compose.yml || ! grep -q '/etc/letsencrypt' compose.yml; then
  log "【中止】compose.yml 缺少 HTTPS 配置（443 端口 / 证书卷）。"
  log "      请确认 Gitee 中 deploy/ecs/compose.yml 是含 HTTPS 的版本后再更新。"
  exit 1
fi

# ---------- 3. .env 必须存在（含数据库密码/JWT 等密钥，不进 git）----------
if [ ! -f .env ]; then
  if [ -f "$SRC_COMPOSE_DIR/.env" ]; then
    cp "$SRC_COMPOSE_DIR/.env" .env
    log ".env 已从原运行目录复制（仅首次）"
  else
    log "【中止】.env 缺失且无复制来源，请先手动放置 .env 再更新"
    exit 1
  fi
fi

# ---------- 4. 获取镜像：CI 模式拉取，否则本机构建 ----------
if [ "$PULL_ONLY" = "1" ]; then
  if [ -z "${API_IMAGE:-}" ] || [ -z "${WEB_IMAGE:-}" ]; then
    log "【中止】--pull-only 需要同时提供 API_IMAGE 与 WEB_IMAGE（镜像完整地址）"
    exit 1
  fi
  log "拉取镜像（跳过本机构建）：api=$API_IMAGE"
  docker compose -f compose.yml pull api frontend \
    || { log "【中止】镜像拉取失败，请检查仓库地址与登录状态"; exit 1; }
else
  # 只构建 api 与 frontend。migrate 不再单独构建 —— 每个镜像构建都会各跑一次 pnpm install，
  # 三次全量安装正是单次发布耗时 27~42 分钟的主因；迁移改为复用 api 镜像执行。
  #
  # 磁盘闸门（2026-10-22 事故）：构建缓存无上限增长，曾涨到 18.5G 把 40G 系统盘顶到 95%，
  # 构建直接卡死在半路、整机失联 74 分钟。这里在开构建前先看可用空间：
  #   < 8G：自动清一次构建缓存（缓存可再生，不影响镜像与数据）
  #   < 4G：直接中止，交给人工处理，绝不在磁盘将满时硬上
  AVAIL_KB=$(df -Pk "$DEPLOY_DIR" | awk 'NR==2 {print $4}')
  if [ "${AVAIL_KB:-0}" -lt 8388608 ]; then
    log "磁盘可用 $((AVAIL_KB / 1024))MB 低于 8G，先清理构建缓存"
    docker builder prune -af >/dev/null 2>&1 || true
    AVAIL_KB=$(df -Pk "$DEPLOY_DIR" | awk 'NR==2 {print $4}')
    log "清理后可用 $((AVAIL_KB / 1024))MB"
  fi
  if [ "${AVAIL_KB:-0}" -lt 4194304 ]; then
    log "【中止】磁盘可用仅 $((AVAIL_KB / 1024))MB（阈值 4G），请先清理磁盘再部署"
    exit 1
  fi

  # 串行构建：2C2G 跑不动「两个镜像同时构建」——内存会冲到 98%，MySQL 被 OOM 杀掉，
  # 整机失联（2026-10-22，74 分钟）。拆成两次调用，确保同一时刻只有一个构建在跑，
  # 代价是总耗时略增，但换来的是发布过程不再把线上打挂。
  log "构建镜像（api）"
  docker compose -f compose.yml build api
  log "构建镜像（frontend）"
  docker compose -f compose.yml build frontend
fi

# ---------- 4.5 迁移前备份（保留最近 3 份）----------
# 迁移可能变更表结构/索引，先留回滚点；备份失败即中止，不执行迁移、也不重建容器。
log "备份数据库（迁移前）"
set -a
# shellcheck disable=SC1091
source .env
set +a
bash "$COMPOSE_DIR/backup.sh" || { log "【中止】数据库备份失败，未执行迁移与重启"; exit 1; }
ls -1t "${DATA_ROOT}/backups/mysql"/*.sql.gz 2>/dev/null | tail -n +4 | xargs -r rm -f || true
log "备份完成（保留最近 3 份）"

# ---------- 5. 应用数据库迁移（新增表/字段/索引）----------
# 此时旧容器仍在运行，迁移成功后才重建容器——迁移失败即中止，不会把线上站点搞挂。
# 说明：本项目迁移均为追加式（建表/加列/加索引），可安全地在旧代码运行期间执行。
# 迁移统一复用 api 镜像执行（镜像内已含 migrate.mjs 与迁移脚本）。
# 不再单独构建 migrate 镜像 —— 那会多一次全量 pnpm install，是构建慢的主因之一。
log "应用数据库迁移（复用 api 镜像）"
docker compose -f compose.yml run --rm -e MIGRATION_APPROVED=true \
  --entrypoint node api scripts/db/migrate.mjs up

# ---------- 5.5 AI 数据目录（必须在挂卷启动前准备好）----------
# 容器以 UID 10001 运行。如果 ${DATA_ROOT}/ai 不存在，docker 会以 root 建一个空目录挂进去，
# 容器内写 sqlite 直接 EACCES —— 表现是「主业务一切正常，只有 AI 页第一次提问就 500」，
# 这种问题从表象极难定位，所以放在启动前显式处理。
mkdir -p "${DATA_ROOT}/ai"
chown -R 10001:10001 "${DATA_ROOT}/ai"
log "AI 数据目录就绪: ${DATA_ROOT}/ai (owner 10001)"

# AI 配置自检：只提示、不中止。AI 是附加能力，配置缺失不应阻断主站发布。
if [ -z "${READONLY_DSN:-}" ]; then
  log "【提示】.env 未配置 READONLY_DSN：AI 查数将返回「未配置」，其余功能不受影响"
else
  log "AI 只读数据源已配置（READONLY_DSN 已设置）"
fi
if [ "${ENABLE_LLM:-false}" = "true" ]; then
  log "【注意】ENABLE_LLM=true：本次发布会启用大模型链路，请确认已通过隐私评审"
fi

# ---------- 6. 重建并启动容器（证书/数据卷在宿主机，不受影响）----------
log "重建并启动服务"
docker compose -f compose.yml up -d
log "更新完成 ✅"
