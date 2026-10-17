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

# ---------- 4. 构建镜像（含 migrate）----------
# 源码有改动时必须重新 build，否则固定镜像名不会自动更新。
# migrate 服务定义在 compose 的 init profile 下，需显式带上 profile 才会一并构建。
log "构建镜像"
docker compose -f compose.yml --profile init build

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
# migrate 服务内置 MIGRATION_APPROVED=true，且 depends_on mysql healthy；
# 此时旧容器仍在运行，迁移成功后才重建容器——迁移失败即中止，不会把线上站点搞挂。
# 说明：本项目迁移均为追加式（建表/加列/加索引），可安全地在旧代码运行期间执行。
log "应用数据库迁移"
docker compose -f compose.yml --profile init run --rm migrate

# ---------- 6. 重建并启动容器（证书/数据卷在宿主机，不受影响）----------
log "重建并启动服务"
docker compose -f compose.yml up -d
log "更新完成 ✅"
