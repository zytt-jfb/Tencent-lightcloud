/**
 * M8 本地隔离 MySQL 集成测试（第 4 项；标记 local-isolated / non-gate）：
 *  - 为每个套件（m2/m3/m5/m6/m8）创建独立临时库
 *  - 注入 BIZ_TEST_MYSQL_DATABASE + MIGRATION_TEST_MYSQL_*，套件脚本自动切 MySQL
 *  - 套件结束后 DROP 库
 * 正式 DEV-067 gate 仍由 run-migrations-mysql.mjs（拒绝 localhost）代表，本脚本仅本地证据。
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requireFromApi = createRequire(path.join(repoRoot, 'apps', 'api', 'package.json'));
const mysql = requireFromApi('mysql2/promise');

const MYSQL = {
  host: process.env.MIGRATION_TEST_MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MIGRATION_TEST_MYSQL_PORT || 34001),
  user: process.env.MIGRATION_TEST_MYSQL_USER || 'biz_migration_test',
  password: process.env.MIGRATION_TEST_MYSQL_PASSWORD || 'BizTest_20260815',
};
const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(MYSQL.host);
const runLabel = isLocalhost ? 'mysql-local' : 'mysql-gate';

const suites = ['run-m2-rbac-auth', 'run-m3-contracts', 'run-m5-offcost', 'run-m6-aggregates', 'run-m8-security', 'run-m9-negative', 'run-m10-negative', 'run-m11-business'];
const results = [];

const admin = await mysql.createConnection({ ...MYSQL, multipleStatements: true });
try {
  for (const suite of suites) {
    const db = `biz_reporting_test_m8_${suite.replace('run-', '')}_${Date.now().toString(36)}`;
    try {
      await admin.query(`CREATE DATABASE \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
      const env = {
        ...process.env,
        NODE_ENV: 'test',
        MIGRATION_TEST_MYSQL_HOST: MYSQL.host,
        MIGRATION_TEST_MYSQL_PORT: String(MYSQL.port),
        MIGRATION_TEST_MYSQL_USER: MYSQL.user,
        MIGRATION_TEST_MYSQL_PASSWORD: MYSQL.password,
        BIZ_TEST_MYSQL_DATABASE: db,
      };
      try {
        execFileSync(process.execPath, [`scripts/test/${suite}.mjs`], { cwd: repoRoot, env, stdio: ['ignore', 'pipe', 'pipe'], timeout: 900_000 });
        results.push({ suite, ok: true });
        console.log(`PASS | ${suite} | ${runLabel}`);
      } catch (e) {
        const tail = String(e.stdout || e.message || '').trim().split('\n').slice(-3).join(' | ');
        results.push({ suite, ok: false });
        console.log(`FAIL | ${suite} | ${tail}`);
      }
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS \`${db}\``);
    }
  }
  const ok = results.filter((r) => r.ok).length;
  const resultLabel = isLocalhost ? 'MYSQL_INTEGRATION_LOCAL' : 'MYSQL_INTEGRATION_GATE';
  const scopeLabel = isLocalhost ? 'local-isolated/non-gate' : 'formal-non-local-gate';
  console.log(`${resultLabel}_${ok === suites.length ? 'PASS' : 'FAIL'} ${ok}/${suites.length} suites (${scopeLabel})`);
} finally {
  await admin.end();
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
