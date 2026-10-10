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

docker compose -f "$SCRIPT_DIR/compose.yml" --env-file "$ENV_FILE" exec -T mysql \
  mysqldump --single-transaction --routines --events --triggers \
  --default-character-set=utf8mb4 \
  -u"$DB_USERNAME" -p"$DB_PASSWORD" "$DB_DATABASE" | gzip -9 > "$output"

echo "Backup created: $output"
