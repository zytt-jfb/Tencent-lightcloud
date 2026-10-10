import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const requireFromApi = createRequire(path.join(repoRoot, 'apps', 'api', 'package.json'));
const Database = requireFromApi('better-sqlite3');
const testRoot = mkdtempSync(path.join(tmpdir(), 'biz-migration-ledger-'));
const database = path.join(testRoot, 'ledger.sqlite');
const env = { ...process.env, NODE_ENV: 'test', DB_TYPE: 'sqlite', DB_DATABASE: database, DB_SYNC: 'false' };

try {
  execFileSync(process.execPath, ['scripts/db/migrate.mjs', 'precheck'], { cwd: repoRoot, env, stdio: 'inherit' });
  execFileSync(process.execPath, ['scripts/db/migrate.mjs', 'up'], { cwd: repoRoot, env, stdio: 'inherit' });

  const db = new Database(database, { readonly: true });
  const firstLedger = db.prepare('SELECT version, status, execution_mode, checksum, applied_at FROM schema_migrations ORDER BY version').all();
  const batchColumns = new Set(db.prepare("PRAGMA table_info('fact_import_batches')").all().map((row) => row.name));
  const versionColumns = new Set(db.prepare("PRAGMA table_info('fact_versions')").all().map((row) => row.name));
  const batchIndexes = new Set(db.prepare("PRAGMA index_list('fact_import_batches')").all().map((row) => row.name));
  const versionIndexes = new Set(db.prepare("PRAGMA index_list('fact_versions')").all().map((row) => row.name));
  const importJobColumns = new Set(db.prepare("PRAGMA table_info('import_jobs')").all().map((row) => row.name));
  const importJobIndexes = new Set(db.prepare("PRAGMA index_list('import_jobs')").all().map((row) => row.name));
  const rateLimitColumns = new Set(db.prepare("PRAGMA table_info('auth_login_rate_limits')").all().map((row) => row.name));
  const securityEventColumns = new Set(db.prepare("PRAGMA table_info('auth_security_events')").all().map((row) => row.name));
  const bizTables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'biz_%'").all().map((row) => row.name));
  const roleCount = db.prepare("SELECT COUNT(*) FROM biz_roles WHERE code IN ('super_admin','admin','contract_manager','city_user')").pluck().get();
  const cityCount = db.prepare("SELECT COUNT(*) FROM biz_cities WHERE code IN ('370100','370200','370300','370400','370500','370600','370700','370800','370900','371000','371100','371300','371400','371500','371600','371700')").pluck().get();
  const categoryCount = db.prepare("SELECT COUNT(*) FROM biz_cost_categories WHERE code IN ('labor','utilities','fuel','entertainment','rent','reimbursement','other')").pluck().get();
  const permCount = db.prepare("SELECT COUNT(*) FROM biz_permissions").pluck().get();
  const rolePermCount = db.prepare("SELECT COUNT(*) FROM biz_role_permissions").pluck().get();
  db.close();

  assert.equal(firstLedger.length, 25, 'expected twenty-five migration ledger rows');
  assert.equal(firstLedger.find((row) => row.version === '002_add_contract_month_invoice_order_amount')?.execution_mode, 'executed');
  assert.equal(firstLedger.find((row) => row.version === '008_v3_fact_lifecycle')?.status, 'applied');
  assert.equal(firstLedger.find((row) => row.version === '009_production_governance')?.status, 'applied');
  assert.equal(firstLedger.find((row) => row.version === '010_biz_baseline_tables')?.status, 'applied');
  assert.equal(firstLedger.find((row) => row.version === '011_biz_seed_main_data')?.status, 'applied');
  assert.equal(firstLedger.find((row) => row.version === '012_biz_permission_seed')?.status, 'applied');
  assert.equal(firstLedger.find((row) => row.version === '013_biz_order_temp_file')?.status, 'applied');
  assert.equal(firstLedger.find((row) => row.version === '014_biz_system_settings')?.status, 'applied');
  assert.equal(firstLedger.find((row) => row.version === '015_import_job_legacy_fields')?.status, 'applied');
  assert.equal(firstLedger.find((row) => row.version === '016_biz_offline_rate_snapshot')?.status, 'applied');
  assert.equal(firstLedger.find((row) => row.version === '017_biz_order_batch_scope')?.status, 'applied');
  assert.equal(firstLedger.find((row) => row.version === '018_biz_order_row_validation')?.status, 'applied');
  assert.equal(firstLedger.find((row) => row.version === '019_biz_admin_crud_permissions')?.status, 'applied');
  assert.equal(firstLedger.find((row) => row.version === '020_biz_contract_soft_delete_op_log')?.status, 'applied');
  assert.equal(firstLedger.find((row) => row.version === '021_biz_contract_permissions')?.status, 'applied');
  assert.equal(firstLedger.find((row) => row.version === '022_biz_province_branch_order_corrections')?.status, 'applied');
  assert.equal(firstLedger.find((row) => row.version === '023_biz_contract_import_records')?.status, 'applied');
  assert.equal(firstLedger.find((row) => row.version === '024_normalize_primary_contract_numbers')?.status, 'applied');
  for (const column of ['lifecycle_status', 'warning_count', 'blocking_error_count', 'effective_at']) assert.ok(batchColumns.has(column), `008 batch column missing: ${column}`);
  for (const column of ['city_id', 'contract_id', 'period_year', 'period_month', 'lifecycle_status', 'supersedes_version_id', 'superseded_by_version_id', 'changed_fields_json', 'warning_summary_json']) assert.ok(versionColumns.has(column), `008 version column missing: ${column}`);
  assert.ok(batchIndexes.has('idx_fact_batch_lifecycle'));
  assert.ok(versionIndexes.has('idx_fact_version_scope_status'));
  assert.ok(versionIndexes.has('idx_fact_version_fact_chain'));
  for (const column of ['source_file_storage_key', 'source_file_sha256', 'source_file_size', 'source_file_stored_at', 'attempt_count', 'processing_started_at', 'failure_code']) assert.ok(importJobColumns.has(column), `009 import_jobs column missing: ${column}`);
  assert.ok(importJobIndexes.has('idx_import_jobs_status_started'), '009 import_jobs status_started index missing');
  assert.ok(importJobIndexes.has('idx_import_jobs_storage_key'), '009 import_jobs storage_key index missing');
  for (const column of ['route_key', 'subject_hash', 'window_started_at', 'attempt_count', 'blocked_until']) assert.ok(rateLimitColumns.has(column), `009 auth_login_rate_limits column missing: ${column}`);
  for (const column of ['event_type', 'outcome', 'route_key', 'subject_hash', 'ip_hash', 'reason_code', 'request_id']) assert.ok(securityEventColumns.has(column), `009 auth_security_events column missing: ${column}`);
  for (const table of ['biz_provinces', 'biz_cities', 'biz_users', 'biz_modules', 'biz_roles', 'biz_permissions', 'biz_role_permissions', 'biz_user_permission_overrides', 'biz_user_data_scopes', 'biz_contracts', 'biz_contract_city_allocations', 'biz_contract_fee_rates', 'biz_contract_alerts', 'biz_order_import_batches', 'biz_order_rows', 'biz_order_import_errors', 'biz_offline_completions', 'biz_cost_entries', 'biz_cost_categories', 'biz_monthly_aggregates', 'biz_aggregate_failures', 'biz_recalc_tasks', 'biz_messages', 'biz_operation_logs']) {
    assert.ok(bizTables.has(table), `010 biz table missing: ${table}`);
  }
  assert.equal(roleCount, 4, '011 seed: expected 4 roles');
  assert.equal(cityCount, 16, '011 seed: expected 16 shandong cities');
  assert.equal(categoryCount, 7, '011 seed: expected 7 cost categories');

  execFileSync(process.execPath, ['scripts/db/migrate.mjs', 'up'], { cwd: repoRoot, env, stdio: 'inherit' });
  const secondDb = new Database(database, { readonly: true });
  const secondLedger = secondDb.prepare('SELECT version, status, execution_mode, checksum, applied_at FROM schema_migrations ORDER BY version').all();
  secondDb.close();
  assert.deepEqual(secondLedger, firstLedger, 'second migration run changed the ledger');
  assert.ok(permCount >= 39, '012 seed: expected >=39 permission points');
  assert.ok(rolePermCount >= 48, '012 seed: expected >=48 role-permission bindings');
  console.log('MIGRATION_LEDGER_CONTRACT_OK migrations=25 v3_lifecycle=true governance009=true baseline010=true seed011=true permission012=true order013=true settings014=true legacy015=true rate016=true batchscope017=true ordervalidation018=true admincrud019=true softdelete020=true contractperms021=true provincebranch022=true contractimports023=true primarycontract024=true idempotent=true');
} finally {
  rmSync(testRoot, { recursive: true, force: true });
  console.log(`MIGRATION_LEDGER_CONTRACT_CLEANUP_OK root=${testRoot}`);
}
