#!/usr/bin/env bash
# 统一校验入口：本地提交前与任意 CI（GitHub Actions / Gitee Go / Jenkins）共用。
# 用法：bash scripts/ci/verify.sh
set -Eeuo pipefail
cd "$(dirname "$0")/../.."

echo "==> 1/4 迁移文件一致性（manifest 与文件 checksum、命名规范）"
pnpm migration-files:check

echo "==> 2/4 类型检查（含 shared-types 构建）"
pnpm typecheck

echo "==> 3/4 全量构建"
pnpm build

echo "==> 4/4 迁移预检（仅在提供数据库连接时执行）"
if [[ -n "${DB_DATABASE:-}" ]]; then
  pnpm db:migrate:precheck
else
  echo "    跳过：未设置 DB_DATABASE（CI 中如需执行请注入数据库连接）"
fi

echo "✅ 全部校验通过"
