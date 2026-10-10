import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requireFromApi = createRequire(path.join(repoRoot, 'apps', 'api', 'package.json'));
const mysql = requireFromApi('mysql2/promise');
const requiredEnvironment = [
  'MIGRATION_TEST_MYSQL_HOST',
  'MIGRATION_TEST_MYSQL_PORT',
  'MIGRATION_TEST_MYSQL_USER',
  'MIGRATION_TEST_MYSQL_PASSWORD',
];
const missingEnvironment = requiredEnvironment.filter((name) => !Object.hasOwn(process.env, name));
if (missingEnvironment.length) {
  throw new Error(`MIGRATION_TEST_MYSQL_ENV_MISSING names=${missingEnvironment.join(',')}`);
}
const host = process.env.MIGRATION_TEST_MYSQL_HOST;
const port = Number(process.env.MIGRATION_TEST_MYSQL_PORT);
const user = process.env.MIGRATION_TEST_MYSQL_USER;
const password = process.env.MIGRATION_TEST_MYSQL_PASSWORD;
if (!host?.trim() || !Number.isInteger(port) || port < 1 || port > 65535 || !user?.trim() || !password?.trim()) {
  throw new Error('MIGRATION_TEST_MYSQL_ENV_INVALID');
}
// 本地隔离副本（non-gate）：允许 localhost（正式 gate 仍拒绝 localhost，见 run-migrations-mysql.mjs）
// 本文件仅用于本地隔离实例的等价验证证据，不代表正式 DEV-067 gate 通过。
if (user.trim().toLowerCase() === 'root') throw new Error('MIGRATION_TEST_MYSQL_ROOT_USER_FORBIDDEN');
if (String(process.env.NODE_ENV).toLowerCase() === 'production') throw new Error('MYSQL_TEST_REFUSES_PRODUCTION_ENV');

const expectedVersions = [
  '001_initial_tables',
  '002_add_contract_month_invoice_order_amount',
  '002_contract_city_business_metrics',
  '003_seed_cities',
  '004_oa_city_soft_delete',
  '005_fact_data_foundation',
  '006_fact_source_file_lineage',
  '007_rbac_auth',
  '008_v3_fact_lifecycle',
  '009_production_governance',
  '010_biz_baseline_tables',
  '011_biz_seed_main_data',
  '012_biz_permission_seed',
  '013_biz_order_temp_file',
  '014_biz_system_settings',
  '015_import_job_legacy_fields',
  '016_biz_offline_rate_snapshot',
  '017_biz_order_batch_scope',
  '018_biz_order_row_validation',
];

const database = `biz_reporting_migration_test_${Date.now()}_${process.pid}`;
const failureDatabase = `${database}_failure`;
const admin = await mysql.createConnection({ host, port, user, password, multipleStatements: false });
try {
  await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  const env = { ...process.env, NODE_ENV: 'test', DB_TYPE: 'mysql', DB_HOST: host, DB_PORT: String(port), DB_USERNAME: user,
    DB_PASSWORD: password, DB_DATABASE: database, DB_SYNC: 'false' };
  execFileSync(process.execPath, ['scripts/db/migrate.mjs', 'precheck'], { cwd: repoRoot, env, stdio: 'inherit' });
  execFileSync(process.execPath, ['scripts/db/migrate.mjs', 'up'], { cwd: repoRoot, env, stdio: 'inherit' });
  execFileSync(process.execPath, ['scripts/db/migrate.mjs', 'status'], { cwd: repoRoot, env, stdio: 'inherit' });
  const verification = await mysql.createConnection({ host, port, user, password, database });
  try {
    const [firstLedger] = await verification.query('SELECT version, status, execution_mode, checksum, applied_at FROM schema_migrations ORDER BY version');
    assert.equal(firstLedger.length, 19, 'expected 001-018 migration ledger entries, including both 002 files');
    assert.deepEqual(firstLedger.map((row) => row.version), expectedVersions, 'migration ledger versions differ from manifest');
    assert.ok(firstLedger.every((row) => row.status === 'applied'), 'all migrations must be applied');
    assert.ok(firstLedger.every((row) => /^[a-f0-9]{64}$/.test(String(row.checksum))), 'every migration requires a SHA-256 checksum');
    assert.ok(firstLedger.every((row) => row.applied_at), 'every applied migration requires applied_at');
    assert.equal(
      firstLedger.find((row) => row.version === '002_add_contract_month_invoice_order_amount')?.execution_mode,
      'executed',
      'an empty database must execute 002 after 001 creates the monthly table without invoice/order columns',
    );
    const [factTables] = await verification.query(`SELECT table_name FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name IN ('fact_import_batches','fact_source_rows','cost_facts','order_facts','fact_versions')`);
    assert.equal(factTables.length, 5, '005 fact tables missing');
    const [lineageColumns] = await verification.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'fact_import_batches'
        AND column_name IN ('source_file_storage_key','source_file_size','source_file_stored_at')`);
    assert.equal(lineageColumns.length, 3, '006 lineage columns missing');
    const [lineageIndex] = await verification.query(`SELECT index_name FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'fact_import_batches' AND index_name = 'idx_fact_batch_storage_key'`);
    assert.ok(lineageIndex.length >= 1, '006 lineage index missing');
    const [rbacColumns] = await verification.query(`SELECT column_name AS column_name, extra AS extra, generation_expression AS generation_expression
      FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'users'
        AND column_name IN ('auth_version','must_change_password','root_admin_singleton')`);
    assert.equal(rbacColumns.length, 3, '007 users columns missing');
    const singletonColumn = rbacColumns.find((row) => row.column_name === 'root_admin_singleton');
    assert.match(String(singletonColumn?.extra || ''), /STORED GENERATED/i, 'root_admin_singleton must be a stored generated column');
    assert.match(String(singletonColumn?.generation_expression || ''), /root_admin/i, 'root_admin_singleton generation expression missing root_admin condition');
    const [rootIndex] = await verification.query(`SELECT index_name AS index_name, non_unique AS non_unique, column_name AS column_name
      FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'users' AND index_name = 'uk_users_single_root_admin'`);
    assert.equal(rootIndex.length, 1, '007 root singleton index missing');
    assert.equal(Number(rootIndex[0].non_unique), 0, 'root singleton index must be unique');
    assert.equal(rootIndex[0].column_name, 'root_admin_singleton');
    const [invitationTable] = await verification.query(`SELECT table_name FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'auth_wechat_invitations'`);
    assert.equal(invitationTable.length, 1, '007 invitation table missing');
    const [invitationIndexes] = await verification.query(`SELECT DISTINCT index_name FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'auth_wechat_invitations'
        AND index_name IN ('uk_auth_wechat_invitation_token_hash','idx_auth_wechat_invitation_user','idx_auth_wechat_invitation_expiry')`);
    assert.equal(invitationIndexes.length, 3, '007 invitation indexes missing');
    const [invitationForeignKeys] = await verification.query(`SELECT constraint_name AS constraint_name, column_name AS column_name, referenced_table_name AS referenced_table_name
      FROM information_schema.key_column_usage
      WHERE table_schema = DATABASE() AND table_name = 'auth_wechat_invitations'
        AND constraint_name IN ('fk_auth_wechat_invitation_user','fk_auth_wechat_invitation_creator')`);
    assert.equal(invitationForeignKeys.length, 2, '007 invitation foreign keys missing');
    assert.ok(invitationForeignKeys.some((row) => row.column_name === 'user_id' && row.referenced_table_name === 'users'));
    assert.ok(invitationForeignKeys.some((row) => row.column_name === 'created_by' && row.referenced_table_name === 'users'));
    const [lifecycleBatchColumns] = await verification.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'fact_import_batches'
        AND column_name IN ('lifecycle_status','warning_count','blocking_error_count','effective_at')`);
    assert.equal(lifecycleBatchColumns.length, 4, '008 import batch lifecycle columns missing');
    const [lifecycleVersionColumns] = await verification.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'fact_versions'
        AND column_name IN ('city_id','contract_id','period_year','period_month','lifecycle_status','supersedes_version_id','superseded_by_version_id','changed_fields_json','warning_summary_json')`);
    assert.equal(lifecycleVersionColumns.length, 9, '008 fact version lifecycle columns missing');
    const [lifecycleIndexes] = await verification.query(`SELECT DISTINCT index_name FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'fact_versions'
        AND index_name IN ('idx_fact_version_scope_status','idx_fact_version_fact_chain')`);
    assert.equal(lifecycleIndexes.length, 2, '008 fact version lifecycle indexes missing');
    const [lifecycleForeignKeys] = await verification.query(`SELECT constraint_name AS constraint_name, column_name AS column_name, referenced_table_name AS referenced_table_name
      FROM information_schema.key_column_usage
      WHERE table_schema = DATABASE() AND table_name = 'fact_versions'
        AND constraint_name IN ('fk_fact_version_supersedes','fk_fact_version_superseded_by')`);
    assert.equal(lifecycleForeignKeys.length, 2, '008 fact version lifecycle foreign keys missing');
    assert.ok(lifecycleForeignKeys.every((row) => row.referenced_table_name === 'fact_versions'));
    const [importJobColumns] = await verification.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'import_jobs'
        AND column_name IN ('source_file_storage_key','source_file_sha256','source_file_size','source_file_stored_at','attempt_count','processing_started_at','failure_code')`);
    assert.equal(importJobColumns.length, 7, '009 import_jobs columns missing');
    const [importJobIndexes] = await verification.query(`SELECT DISTINCT index_name FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'import_jobs'
        AND index_name IN ('idx_import_jobs_status_started','idx_import_jobs_storage_key')`);
    assert.equal(importJobIndexes.length, 2, '009 import_jobs indexes missing');
    const [rateLimitTable] = await verification.query(`SELECT table_name FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'auth_login_rate_limits'`);
    assert.equal(rateLimitTable.length, 1, '009 auth_login_rate_limits table missing');
    const [rateLimitColumns] = await verification.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'auth_login_rate_limits'
        AND column_name IN ('route_key','subject_hash','window_started_at','attempt_count','blocked_until','updated_at')`);
    assert.equal(rateLimitColumns.length, 6, '009 auth_login_rate_limits columns missing');
    const [rateLimitIndexes] = await verification.query(`SELECT DISTINCT index_name FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'auth_login_rate_limits'
        AND index_name IN ('uk_auth_rate_route_subject','idx_auth_rate_blocked')`);
    assert.equal(rateLimitIndexes.length, 2, '009 auth_login_rate_limits indexes missing');
    const [securityEventsTable] = await verification.query(`SELECT table_name FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = 'auth_security_events'`);
    assert.equal(securityEventsTable.length, 1, '009 auth_security_events table missing');
    const [securityEventIndexes] = await verification.query(`SELECT DISTINCT index_name FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'auth_security_events'
      AND index_name IN ('idx_auth_event_created','idx_auth_event_subject','idx_auth_event_ip')`);
    assert.equal(securityEventIndexes.length, 3, '009 auth_security_events indexes missing');
    const [bizTables] = await verification.query(`SELECT table_name FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name LIKE 'biz_%'`);
    assert.ok(bizTables.length >= 24, '010 biz baseline tables missing');
    const [bizContractsColumns] = await verification.query(`SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = 'biz_contracts'
        AND column_name IN ('id','contract_no','tax_inclusive_amount_fen','province_id','status','parent_contract_id','version_no')`);
    assert.equal(bizContractsColumns.length, 7, '010 biz_contracts key columns missing');
    const [contractNoUnique] = await verification.query(`SELECT index_name FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = 'biz_contracts' AND index_name = 'uk_biz_contracts_no'`);
    assert.ok(contractNoUnique.length >= 1, '010 biz_contracts unique contract_no index missing');
    const [seedRoles] = await verification.query(`SELECT COUNT(*) AS c FROM biz_roles WHERE code IN ('super_admin','admin','contract_manager','city_user')`);
    assert.equal(Number(seedRoles[0].c), 4, '011 seed: expected 4 roles');
    const [seedCities] = await verification.query(`SELECT COUNT(*) AS c FROM biz_cities
      WHERE code IN ('370100','370200','370300','370400','370500','370600','370700','370800','370900','371000','371100','371300','371400','371500','371600','371700')`);
    assert.equal(Number(seedCities[0].c), 16, '011 seed: expected 16 shandong cities');
    const [seedCategories] = await verification.query(`SELECT COUNT(*) AS c FROM biz_cost_categories
      WHERE code IN ('labor','utilities','fuel','entertainment','rent','reimbursement','other')`);
    assert.equal(Number(seedCategories[0].c), 7, '011 seed: expected 7 cost categories');

    await verification.query(`INSERT INTO users (role, name, username, status)
      VALUES ('root_admin', '迁移隔离根账号', ?, 'enabled')`, [`migration_root_${process.pid}`]);
    await assert.rejects(
      verification.query(`INSERT INTO users (role, name, username, status)
        VALUES ('root_admin', '迁移隔离第二根', ?, 'enabled')`, [`migration_second_root_${process.pid}`]),
      (error) => error?.code === 'ER_DUP_ENTRY',
      'database must reject a second root_admin',
    );
    execFileSync(process.execPath, ['scripts/db/migrate.mjs', 'up'], { cwd: repoRoot, env, stdio: 'inherit' });
    execFileSync(process.execPath, ['scripts/db/migrate.mjs', 'status'], { cwd: repoRoot, env, stdio: 'inherit' });
    const [secondLedger] = await verification.query('SELECT version, status, execution_mode, checksum, applied_at FROM schema_migrations ORDER BY version');
    assert.deepEqual(JSON.parse(JSON.stringify(secondLedger)), JSON.parse(JSON.stringify(firstLedger)), 'second up changed migration ledger');
  } finally {
    await verification.end();
  }
  console.log(`MYSQL_MIGRATION_ISOLATION_OK database=${database}`);

  await admin.query(`CREATE DATABASE \`${failureDatabase}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  const failureEnv = {
    ...env,
    DB_DATABASE: failureDatabase,
    MIGRATION_TEST_FORCE_FAILURE_VERSION: '005_fact_data_foundation',
  };
  let rejected = false;
  try {
    execFileSync(process.execPath, ['scripts/db/migrate.mjs', 'up'], { cwd: repoRoot, env: failureEnv, stdio: 'inherit' });
  } catch {
    rejected = true;
  }
  assert.equal(rejected, true, 'forced failing migration unexpectedly succeeded');
  const failureVerification = await mysql.createConnection({ host, port, user, password, database: failureDatabase });
  try {
    const [failedRows] = await failureVerification.query(`SELECT version, status, execution_mode, error_message
      FROM schema_migrations WHERE version = '005_fact_data_foundation'`);
    assert.equal(failedRows.length, 1, 'failed migration ledger entry missing');
    assert.equal(failedRows[0].status, 'failed');
    assert.equal(failedRows[0].execution_mode, 'executed');
    assert.match(String(failedRows[0].error_message), /FORCED_TEST_FAILURE/);
  } finally {
    await failureVerification.end();
  }
  // 部分状态拒绝：previous failed 存在时再次 up 必须被 precheck 拦截
  let blocked = false;
  try {
    execFileSync(process.execPath, ['scripts/db/migrate.mjs', 'up'], { cwd: repoRoot, env: failureEnv, stdio: 'inherit' });
  } catch {
    blocked = true;
  }
  assert.equal(blocked, true, 'precheck must block re-up while a previous migration is failed');
  console.log(`MYSQL_MIGRATION_FAILURE_LEDGER_OK database=${failureDatabase} partial_state_rejected=true`);
} finally {
  try {
    await admin.query(`DROP DATABASE IF EXISTS \`${database}\``);
    await admin.query(`DROP DATABASE IF EXISTS \`${failureDatabase}\``);
    const [remaining] = await admin.query(
      'SELECT schema_name FROM information_schema.schemata WHERE schema_name IN (?, ?)',
      [database, failureDatabase],
    );
    assert.equal(remaining.length, 0, 'temporary migration databases were not deleted');
    console.log(`MYSQL_MIGRATION_CLEANUP_OK databases=${database},${failureDatabase}`);
  } finally {
    await admin.end();
  }
}
