#!/usr/bin/env node
/**
 * 新增数据库迁移的脚手架。
 *
 * 背景：加一个迁移原本需要同步三处 —— SQL 文件、scripts/db/migration-checksums.json、
 * scripts/db/migrate.mjs 的 inspectState() 分支。漏掉任意一处都会在部署时才暴露
 * （checksum 未登记 → MIGRATION_CHECKSUM_UNPINNED；未加 inspectState → STATE_CHECK_MISSING）。
 * 本脚本自动完成前两步，并打印第三步需要粘贴的代码片段。
 *
 * 用法：
 *   MIGRATION_SQL="CREATE INDEX idx_x ON t (a);" node scripts/db/new-migration.mjs 040_order_index_tuning
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '../..');
const migrationDir = path.join(repoRoot, 'apps/api/migration');
const manifestPath = path.join(repoRoot, 'scripts/db/migration-checksums.json');
const migrateScript = path.join(repoRoot, 'scripts/db/migrate.mjs');

const name = process.argv[2];
if (!name || !/^\d{3}_[a-z0-9_]+$/.test(name)) {
  console.error('用法: MIGRATION_SQL="<SQL>" node scripts/db/new-migration.mjs 040_your_change');
  console.error('命名要求: 3 位编号 + 下划线小写，例如 040_order_index_tuning');
  process.exit(1);
}

const filePath = path.join(migrationDir, `${name}.sql`);
if (fs.existsSync(filePath)) {
  console.error(`已存在同名迁移文件: ${name}.sql`);
  process.exit(1);
}

const body = process.env.MIGRATION_SQL;
if (!body || !body.trim()) {
  console.error('必须通过 MIGRATION_SQL 环境变量提供 SQL 内容（不留空迁移模板，避免误提交）');
  process.exit(1);
}
// 与 check-files 的校验规则保持一致
if (!/^(CREATE|ALTER|INSERT|SET|--)/m.test(body.trim())) {
  console.error('SQL 必须以 CREATE / ALTER / INSERT / SET / -- 开头（与 check-files 规则一致）');
  process.exit(1);
}

fs.writeFileSync(filePath, body.endsWith('\n') ? body : `${body}\n`, 'utf8');

// 与 migrate.mjs 的 sha256 计算方式保持一致（对文件 UTF-8 原文取哈希）
const checksum = createHash('sha256').update(fs.readFileSync(filePath, 'utf8')).digest('hex');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
if (manifest[name]) {
  console.error(`manifest 中已存在条目: ${name}`);
  process.exit(1);
}
manifest[name] = checksum;
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const hasBranch = fs.readFileSync(migrateScript, 'utf8').includes(`version === '${name}'`);

console.log(`[ok] 已创建 apps/api/migration/${name}.sql`);
console.log(`[ok] 已登记 checksum ${checksum.slice(0, 12)}... 到 migration-checksums.json`);
console.log('');

if (hasBranch) {
  console.log('[ok] inspectState 已存在该版本分支');
} else {
  console.log('[todo] 还差一步，否则 migrate 会报 STATE_CHECK_MISSING：');
  console.log('       在 scripts/db/migrate.mjs 的 inspectState() 中、fail(...) 之前插入：');
  console.log('');
  console.log(`  if (version === '${name}') {`);
  console.log(`    if (!await adapter.tableExists('<目标表>')) return 'empty';`);
  console.log(`    return await adapter.indexExists('<目标表>', '<目标索引或约束>') ? 'satisfied' : 'empty';`);
  console.log(`  }`);
  console.log('');
}

console.log('校验并执行：');
console.log('  pnpm migration-files:check && pnpm db:migrate:precheck && pnpm db:migrate');
