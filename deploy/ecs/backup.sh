#!/usr/bin/env bash
set -Eeuo pipefail

# 用法: 在 deploy/ecs 目录执行  bash backup.sh
# 依赖: 同目录 .env 与 compose.yml，以及运行中的 mysql 容器。

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$SCRIPT_DIR/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

DATA_ROOT="${DATA_ROOT:?set DATA_ROOT in .env}"
BACKUP_DIR="$DATA_ROOT/backups/mysql"
mkdir -p "$BACKUP_DIR"
stamp="$(date +%Y%m%d-%H%M%S)"
output="$BACKUP_DIR/${DB_DATABASE}-${stamp}.sql.gz"

# --no-tablespaces：业务账号（如 biz_runtime）通常没有 PROCESS 权限，
# 缺此参数时 mysqldump 会在导出 tablespace 阶段中断，产出"缺表且无结束标记"的坏备份。
tmp="$output.part"
docker compose -f "$SCRIPT_DIR/compose.yml" --env-file "$ENV_FILE" exec -T mysql \
  mysqldump --single-transaction --no-tablespaces --routines --events --triggers \
  --default-character-set=utf8mb4 \
  -u"$DB_USERNAME" -p"$DB_PASSWORD" "$DB_DATABASE" | gzip -9 > "$tmp"

# 完整性校验：mysqldump 正常结束会在末尾写 "Dump completed" 标记；缺失则丢弃，避免留下不可恢复的备份。
if ! zcat "$tmp" | tail -c 400 | grep -q "Dump completed"; then
  echo "Backup verification FAILED: missing 'Dump completed' marker, partial file removed" >&2
  rm -f "$tmp"
  exit 1
fi
mv "$tmp" "$output"

echo "Backup created: $output"
