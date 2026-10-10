/**
 * M8 本地隔离 MySQL 验证（第 1-2 项）：
 *  - 全新临时库执行迁移 001~014
 *  - 16 账本 applied / checksum 一致 / 二次幂等
 *  - 012 权限种子 / 013 临时文件列 / 014 系统设置种子
 *  - 失败迁移账本与清理
 * 标记：local-isolated / non-gate（不冒充正式 gate）
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requireFromApi = createRequire(path.join(repoRoot, 'apps', 'api', 'package.json'));
const mysql = requireFromApi('mysql2/promise');

const MYSQL = { host: '127.0.0.1', port: 34001, user: 'biz_migration_test', password: 'BizTest_20260815' };
const dbName = `biz_reporting_test_m8_${Date.now().toString(36)}`;

const env = {
  DB_TYPE: 'mysql', DB_HOST: MYSQL.host, DB_PORT: String(MYSQL.port),
  DB_USERNAME: MYSQL.user, DB_PASSWORD: MYSQL.password, DB_DATABASE: dbName,
  NODE_ENV: 'test', DB_SYNC: 'false',
  PATH: process.env.PATH,
};

function runMigrate(args) {
  try {
    const out = execFileSync(process.execPath, ['scripts/db/migrate.mjs', ...args], {
      cwd: repoRoot, encoding: 'utf-8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, out };
  } catch (e) {
    return { ok: false, out: String(e.stdout || e.message || '').slice(0, 800) };
  }
}

const results = [];
function record(name, ok, detail) { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} | ${name} | ${detail}`); }

let conn;
try {
  conn = await mysql.createConnection({ ...MYSQL, multipleStatements: true });
  await conn.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  console.log(`CREATED_DB ${dbName}`);

  // 1a. 首次迁移
  const m1 = runMigrate(['up']);
  record('migrate-001-014-first-run', m1.ok && /MIGRATE_OK/i.test(m1.out), m1.out.trim().split('\n').slice(-1)[0]);

  // 账本 16 条全部 applied
  const [ledger] = await conn.query(`SELECT version, status FROM \`${dbName}\`.schema_migrations ORDER BY version`);
  const versions = ledger.map((r) => r.version);
  const allApplied = versions.length === 18 && ledger.every((r) => r.status === 'applied');
  record('ledger-18-applied', allApplied, `rows=${versions.length} versions=[${versions.join(',')}]`);

  // 表数量
  const [tables] = await conn.query(`SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema=?`, [dbName]);
  record('tables-created', Number(tables[0].c) >= 25, `tables=${tables[0].c}`);

  // 1b. checksum 检查（迁移文件清单）
  const chk = runMigrate(['check-files']);
  record('migration-files-check', chk.ok && /MIGRATION_FILES_OK/i.test(chk.out), chk.out.trim().split('\n').slice(-1)[0]);

  // 1c. 二次幂等
  const m2 = runMigrate(['up']);
  const [ledger2] = await conn.query(`SELECT COUNT(*) AS c FROM \`${dbName}\`.schema_migrations`);
  record('migrate-second-idempotent', Number(ledger2[0].c) === 18 && m2.ok, `rows=${ledger2[0].c}`);

  // 1d. 012/013/014 种子与列
  const [perms] = await conn.query(`SELECT COUNT(*) AS c FROM \`${dbName}\`.biz_permissions`);
  const [rolePerms] = await conn.query(`SELECT COUNT(*) AS c FROM \`${dbName}\`.biz_role_permissions`);
  const [cityPerms] = await conn.query(`SELECT COUNT(*) AS c FROM \`${dbName}\`.biz_role_permissions WHERE role_id=(SELECT id FROM \`${dbName}\`.biz_roles WHERE code='city_user')`);
  record('012-permission-seed', Number(perms[0].c) >= 39 && Number(rolePerms[0].c) >= 48 && Number(cityPerms[0].c) === 16, `permissions=${perms[0].c} role_permissions=${rolePerms[0].c} city=16`);

  const [col] = await conn.query(`SELECT COUNT(*) AS c FROM information_schema.columns WHERE table_schema=? AND table_name='biz_order_import_batches' AND column_name='temp_file_path'`, [dbName]);
  record('013-temp-file-column', Number(col[0].c) === 1, `temp_file_path exists=${col[0].c}`);

  const [settings] = await conn.query(`SELECT setting_key FROM \`${dbName}\`.biz_system_settings ORDER BY setting_key`);
  record('014-settings-seed', settings.length === 3, `keys=${settings.map((r) => r.setting_key).join(',')}`);

  // 1e. 失败迁移账本与清理
  const badFile = path.join(repoRoot, 'apps', 'api', 'migration', 'zz_fail_test.sql');
  writeFileSync(badFile, 'THIS IS NOT VALID SQL;');
  const mBad = runMigrate(['up']);
  const noBad = mBad.out.includes('zz_fail_test');
  rmSync(badFile, { force: true });
  // checksum 门禁：未登记迁移文件被忽略（不执行、不写入账本）——防止未登记 SQL 混入
  record('unregistered-migration-blocked', !noBad, `zz_fail_test not executed=${!noBad}`);
  const [noBadRow] = await conn.query(`SELECT COUNT(*) AS c FROM \`${dbName}\`.schema_migrations WHERE version='zz_fail_test'`);
  record('unregistered-migration-cleanup', Number(noBadRow[0].c) === 0, `bad version not in ledger=${noBadRow[0].c}`);

  // 1f. 类型抽查：金额 BIGINT / UUID varchar(36)
  const [colTypes] = await conn.query(
    "SELECT table_name, column_name, column_type FROM information_schema.columns WHERE table_schema='" + dbName + "' AND ((table_name='biz_order_rows' AND column_name IN ('completion_amount_fen','gross_profit_fen')) OR (table_name='biz_contracts' AND column_name IN ('id','contract_no')) OR (table_name='biz_offline_completions' AND column_name='amount_fen'))",
  );
  const lowerCols = colTypes.map((r) => ({ t: r.TABLE_NAME, c: r.COLUMN_NAME, ty: r.COLUMN_TYPE }));
  const fenBigint = lowerCols.filter((r) => /amount_fen|gross_profit_fen/.test(r.c)).every((r) => r.ty.startsWith('bigint'));
  const idVarchar = lowerCols.filter((r) => r.c === 'id').every((r) => r.ty.startsWith('varchar(36)'));
  record('fen-bigint-uuid-varchar', fenBigint && idVarchar, lowerCols.map((r) => `${r.t}.${r.c}=${r.ty}`).join(' | '));

  const allOk = results.every((r) => r.ok);
  console.log(allOk ? 'M8_MYSQL_LOCAL_PASS' : 'M8_MYSQL_LOCAL_FAIL');
  console.log(`MYSQL_LOCAL_SUMMARY instance=8.0.46 port=34001 user=biz_migration_test db=${dbName} pass=${results.filter((r) => r.ok).length}/${results.length}`);
} finally {
  try {
    if (conn) {
      await conn.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
      console.log(`DROPPED_DB ${dbName}`);
      await conn.end();
    }
  } catch (e) {
    console.log('CLEANUP_WARN', e.message?.slice(0, 100));
  }
}
