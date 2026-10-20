import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const apiRoot = path.join(repoRoot, 'apps', 'api');
const migrationDir = path.join(apiRoot, 'migration');
const requireFromApi = createRequire(path.join(apiRoot, 'package.json'));
const command = process.argv[2] || 'status';
const dialect = String(process.env.DB_TYPE || 'sqlite').toLowerCase();
const migrations = fs.readdirSync(migrationDir)
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort((a, b) => a.localeCompare(b, 'en'))
  .map((filename) => {
    const sql = fs.readFileSync(path.join(migrationDir, filename), 'utf8');
    return { version: filename.replace(/\.sql$/, ''), filename, sql, checksum: sha256(sql) };
  });

if (command === 'check-files') {
  checkMigrationFiles();
  process.exit(0);
}
if (!['sqlite', 'mysql'].includes(dialect)) fail(`DB_TYPE_UNSUPPORTED type=${dialect}`);
validateConfiguration();
const adapter = dialect === 'sqlite' ? openSqlite() : await openMysql();

try {
  if (command === 'status') await printStatus();
  else if (command === 'precheck') await precheck();
  else if (command === 'up') await migrateUp();
  else fail(`COMMAND_UNSUPPORTED command=${command}`);
} finally {
  await adapter.close();
}

async function precheck() {
  const rows = await loadLedger();
  const applied = new Map(rows.map((row) => [row.version, row]));
  let blockers = 0;
  for (const migration of migrations) {
    const row = applied.get(migration.version);
    const state = await inspectState(migration.version);
    if (row?.status === 'applied' && row.checksum !== migration.checksum) {
      blockers += 1;
      console.error(`BLOCK checksum_drift version=${migration.version}`);
    } else if (row?.status === 'failed') {
      blockers += 1;
      console.error(`BLOCK previous_failure version=${migration.version} error=${clean(row.error_message)}`);
    } else if (!row && state === 'partial' && !(migration.version === '034_maintenance_detail_fields' && await canRepairMaintenanceDetailFields())) {
      blockers += 1;
      console.error(`BLOCK partial_state version=${migration.version}`);
    } else {
      console.log(`OK version=${migration.version} ledger=${row?.status || 'none'} database=${state}`);
    }
  }
  if (blockers) fail(`PRECHECK_FAILED blockers=${blockers}`);
  console.log(`PRECHECK_OK dialect=${dialect} migrations=${migrations.length}`);
}

async function printStatus() {
  const rows = await loadLedger();
  const applied = new Map(rows.map((row) => [row.version, row]));
  for (const migration of migrations) {
    const row = applied.get(migration.version);
    const state = await inspectState(migration.version);
    const status = row ? row.status : state === 'satisfied' ? 'adoptable' : state === 'empty' ? 'pending' : 'blocked-partial';
    console.log(`${migration.version}\t${status}\t${row?.execution_mode || '-'}\t${migration.checksum.slice(0, 12)}`);
  }
}

async function migrateUp() {
  if (String(process.env.NODE_ENV).toLowerCase() === 'production' && process.env.MIGRATION_APPROVED !== 'true') {
    fail('PRODUCTION_APPROVAL_REQUIRED set_MIGRATION_APPROVED=true');
  }
  await ensureLedger();
  await precheck();
  const applied = new Map((await loadLedger()).map((row) => [row.version, row]));
  for (const migration of migrations) {
    if (applied.get(migration.version)?.status === 'applied') continue;
    const state = await inspectState(migration.version);
    const started = Date.now();
    if (state === 'satisfied') {
      await recordApplied(migration, 'adopted_existing', Date.now() - started);
      console.log(`ADOPT version=${migration.version}`);
      continue;
    }
    if (state === 'partial' && migration.version === '034_maintenance_detail_fields' && await canRepairMaintenanceDetailFields()) {
      await recordStarting(migration);
      try {
        await applyMaintenanceDetailFields();
        if (await inspectState(migration.version) !== 'satisfied') fail('POSTCHECK_FAILED');
        await recordApplied(migration, 'repaired_additive', Date.now() - started);
        console.log(`REPAIR version=${migration.version} ms=${Date.now() - started}`);
        continue;
      } catch (error) {
        await recordFailed(migration, error);
        fail(`MIGRATION_REPAIR_FAILED version=${migration.version} error=${clean(error instanceof Error ? error.message : error)}`);
      }
    }
    if (state !== 'empty') fail(`PARTIAL_STATE version=${migration.version}`);
    await recordStarting(migration);
    try {
      await applyMigration(migration);
      if (await inspectState(migration.version) !== 'satisfied') fail('POSTCHECK_FAILED');
      await recordApplied(migration, 'executed', Date.now() - started);
      console.log(`APPLY version=${migration.version} ms=${Date.now() - started}`);
    } catch (error) {
      await recordFailed(migration, error);
      fail(`MIGRATION_FAILED version=${migration.version} error=${clean(error instanceof Error ? error.message : error)}`);
    }
  }
  console.log(`MIGRATE_OK dialect=${dialect} migrations=${migrations.length}`);
}

async function applyMigration(migration) {
  if (
    String(process.env.NODE_ENV).toLowerCase() === 'test'
    && process.env.MIGRATION_TEST_FORCE_FAILURE_VERSION === migration.version
  ) {
    fail(`FORCED_TEST_FAILURE version=${migration.version}`);
  }
  if (migration.version === '002_add_contract_month_invoice_order_amount') {
    for (const [column, definition] of [['invoice_amount', 'DECIMAL(18,2) NULL'], ['order_amount', 'DECIMAL(18,2) NULL']]) {
      if (!await adapter.columnExists('report_contract_monthly_rows', column)) {
        await adapter.exec(`ALTER TABLE report_contract_monthly_rows ADD COLUMN ${column} ${definition}`);
      }
    }
    return;
  }
  if (migration.version === '003_seed_cities') {
    await adapter.exec(dialect === 'sqlite' ? sqliteSeedCities() : migration.sql);
    return;
  }
  if (migration.version === '004_oa_city_soft_delete') {
    if (!await adapter.columnExists('cities', 'is_deleted')) await adapter.exec('ALTER TABLE cities ADD COLUMN is_deleted TINYINT NOT NULL DEFAULT 0');
    if (!await adapter.columnExists('cities', 'deleted_at')) await adapter.exec('ALTER TABLE cities ADD COLUMN deleted_at DATETIME NULL');
    if (!await adapter.indexExists('cities', 'idx_cities_deleted_sort')) await adapter.exec('CREATE INDEX idx_cities_deleted_sort ON cities (is_deleted, sort_order, id)');
    return;
  }
  if (migration.version === '034_maintenance_detail_fields') {
    await applyMaintenanceDetailFields();
    return;
  }
  if (migration.version === '006_fact_source_file_lineage') {
    const columns = [
      ['source_file_storage_key', 'VARCHAR(500) NULL'],
      ['source_file_size', 'BIGINT NULL'],
      ['source_file_stored_at', 'DATETIME NULL'],
    ];
    for (const [column, definition] of columns) {
      if (!await adapter.columnExists('fact_import_batches', column)) {
        await adapter.exec(`ALTER TABLE fact_import_batches ADD COLUMN ${column} ${definition}`);
      }
    }
    if (!await adapter.indexExists('fact_import_batches', 'idx_fact_batch_storage_key')) {
      await adapter.exec('CREATE INDEX idx_fact_batch_storage_key ON fact_import_batches (source_file_storage_key)');
    }
    return;
  }
  if (migration.version === '007_rbac_auth') {
    if (!await adapter.columnExists('users', 'auth_version')) {
      await adapter.exec('ALTER TABLE users ADD COLUMN auth_version INT NOT NULL DEFAULT 1');
    }
    if (!await adapter.columnExists('users', 'must_change_password')) {
      await adapter.exec('ALTER TABLE users ADD COLUMN must_change_password TINYINT NOT NULL DEFAULT 0');
    }
    if (dialect === 'mysql' && !await adapter.columnExists('users', 'root_admin_singleton')) {
      await adapter.exec("ALTER TABLE users ADD COLUMN root_admin_singleton TINYINT GENERATED ALWAYS AS (CASE WHEN role = 'root_admin' THEN 1 ELSE NULL END) STORED");
    }
    if (!await adapter.indexExists('users', 'uk_users_single_root_admin')) {
      await adapter.exec(dialect === 'sqlite'
        ? "CREATE UNIQUE INDEX uk_users_single_root_admin ON users (role) WHERE role = 'root_admin'"
        : 'CREATE UNIQUE INDEX uk_users_single_root_admin ON users (root_admin_singleton)');
    }
    if (!await adapter.tableExists('auth_wechat_invitations')) {
      await adapter.exec(dialect === 'sqlite' ? sqliteWechatInvitations() : mysqlWechatInvitations());
    }
    return;
  }
  if (migration.version === '008_v3_fact_lifecycle' && dialect === 'sqlite') {
    await applySqliteV3FactLifecycle();
    return;
  }
  if (migration.version === '009_production_governance' && dialect === 'sqlite') {
    await applySqliteProductionGovernance();
    return;
  }
  if (migration.version === '017_biz_order_batch_scope') {
    if (!await adapter.columnExists('biz_order_import_batches', 'data_scope_json')) {
      await adapter.exec('ALTER TABLE biz_order_import_batches ADD COLUMN data_scope_json VARCHAR(500) NULL');
    }
    return;
  }
  if (migration.version === '018_biz_order_row_validation') {
    const columns = [
      ['validation_status', "VARCHAR(16) NOT NULL DEFAULT 'valid'"],
      ['validation_error', 'TEXT NULL'],
    ];
    for (const [column, definition] of columns) {
      if (!await adapter.columnExists('biz_order_rows', column)) {
        await adapter.exec(`ALTER TABLE biz_order_rows ADD COLUMN ${column} ${definition}`);
      }
    }
    return;
  }
  if (migration.version === '020_biz_contract_soft_delete_op_log') {
    const columns = [
      ['biz_contracts', 'deleted_at', 'DATETIME NULL'],
      ['biz_contracts', 'deleted_by', 'VARCHAR(36) NULL'],
      ['biz_contracts', 'deleted_batch_id', 'VARCHAR(36) NULL'],
      ['biz_operation_logs', 'summary_before', 'TEXT NULL'],
      ['biz_operation_logs', 'summary_after', 'TEXT NULL'],
      ['biz_operation_logs', 'batch_id', 'VARCHAR(36) NULL'],
      ['biz_operation_logs', 'error_message', 'TEXT NULL'],
    ];
    for (const [table, column, definition] of columns) {
      if (!await adapter.columnExists(table, column)) {
        await adapter.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
      }
    }
    if (!await adapter.indexExists('biz_contracts', 'idx_biz_contracts_deleted')) {
      await adapter.exec('CREATE INDEX idx_biz_contracts_deleted ON biz_contracts (deleted_at)');
    }
    if (!await adapter.indexExists('biz_operation_logs', 'idx_biz_op_log_batch')) {
      await adapter.exec('CREATE INDEX idx_biz_op_log_batch ON biz_operation_logs (batch_id)');
    }
    return;
  }
  if (migration.version === '022_biz_province_branch_order_corrections') {
    const columns = [
      ['biz_cities', 'unit_type', "VARCHAR(32) NOT NULL DEFAULT 'city'"],
      ['biz_order_import_batches', 'source_batch_id', 'VARCHAR(36) NULL'],
      ['biz_order_import_batches', 'batch_purpose', "VARCHAR(16) NOT NULL DEFAULT 'normal'"],
      ['biz_order_rows', 'replaces_order_row_id', 'VARCHAR(36) NULL'],
      ['biz_order_rows', 'resolved_by_batch_id', 'VARCHAR(36) NULL'],
      ['biz_order_rows', 'resolved_by_user_id', 'VARCHAR(36) NULL'],
      ['biz_order_rows', 'resolved_at', 'DATETIME NULL'],
    ];
    for (const [table, column, definition] of columns) {
      if (!await adapter.columnExists(table, column)) await adapter.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
    if (!await adapter.indexExists('biz_order_import_batches', 'idx_biz_order_batch_source')) {
      await adapter.exec('CREATE INDEX idx_biz_order_batch_source ON biz_order_import_batches (source_batch_id)');
    }
    if (!await adapter.indexExists('biz_order_rows', 'idx_biz_order_row_replaces')) {
      await adapter.exec('CREATE INDEX idx_biz_order_row_replaces ON biz_order_rows (replaces_order_row_id)');
    }
    if (!await adapter.indexExists('biz_order_rows', 'uk_biz_order_row_replaces')) {
      await adapter.exec('CREATE UNIQUE INDEX uk_biz_order_row_replaces ON biz_order_rows (replaces_order_row_id)');
    }
    if (!await adapter.indexExists('biz_order_rows', 'idx_biz_order_row_resolved_batch')) {
      await adapter.exec('CREATE INDEX idx_biz_order_row_resolved_batch ON biz_order_rows (resolved_by_batch_id)');
    }
    const insertIgnore = dialect === 'sqlite' ? 'INSERT OR IGNORE' : 'INSERT IGNORE';
    await adapter.exec(`${insertIgnore} INTO biz_cities (id, province_id, code, name, unit_type, status)
      VALUES ('00000000-0000-4000-8000-000000000117', '00000000-0000-4000-8000-000000000030', '370000-BRANCH', '山东省分公司', 'province_branch', 'active')`);
    const aliases = [
      ['00000000-0000-4000-8000-000000000181', '山东省分公司'],
      ['00000000-0000-4000-8000-000000000182', '山东分公司'],
      ['00000000-0000-4000-8000-000000000183', '山东省公司'],
      ['00000000-0000-4000-8000-000000000184', '省公司'],
      ['00000000-0000-4000-8000-000000000185', '省本部'],
    ];
    for (const [id, alias] of aliases) {
      await adapter.exec(`${insertIgnore} INTO biz_city_aliases (id, city_id, alias)
        VALUES ('${id}', '00000000-0000-4000-8000-000000000117', '${alias}')`);
    }
    return;
  }
  if (migration.version === '023_biz_contract_import_records') {
    const contractColumns = [
      ['archive_contract_no', 'VARCHAR(100) NULL'], ['project_identity_code', 'VARCHAR(160) NULL'],
      ['contract_category_1', 'VARCHAR(100) NULL'], ['contract_category_2', 'VARCHAR(100) NULL'],
      ['winning_project_name', 'VARCHAR(500) NULL'], ['signed_date', 'DATE NULL'],
      ['tax_rate_raw', 'VARCHAR(255) NULL'], ['tax_rate_bp', 'INT NULL'], ['tax_rate_bps_json', 'JSON NULL'],
      ['source_import_record_id', 'VARCHAR(36) NULL'], ['source_sheet_id', 'VARCHAR(36) NULL'],
      ['source_row_id', 'VARCHAR(36) NULL'], ['source_row_no', 'INT NULL'],
    ];
    for (const [column, definition] of contractColumns) {
      if (!await adapter.columnExists('biz_contracts', column)) await adapter.exec(`ALTER TABLE biz_contracts ADD COLUMN ${column} ${definition}`);
    }
    if (!await adapter.indexExists('biz_contracts', 'idx_biz_contracts_source_import')) {
      await adapter.exec('CREATE INDEX idx_biz_contracts_source_import ON biz_contracts (source_import_record_id)');
    }
    if (!await adapter.tableExists('biz_contract_import_records')) {
      await adapter.exec(`CREATE TABLE biz_contract_import_records (
        id VARCHAR(36) PRIMARY KEY, filename VARCHAR(255) NOT NULL, file_hash VARCHAR(64) NOT NULL,
        status VARCHAR(16) NOT NULL DEFAULT 'parsing', sheet_count INT NOT NULL DEFAULT 0,
        total_rows INT NOT NULL DEFAULT 0, valid_rows INT NOT NULL DEFAULT 0, review_rows INT NOT NULL DEFAULT 0,
        uploaded_by VARCHAR(36) NOT NULL, data_scope_json TEXT NULL, completed_at DATETIME NULL,
        failure_reason TEXT NULL, uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
    }
    if (!await adapter.tableExists('biz_contract_import_sheets')) {
      await adapter.exec(`CREATE TABLE biz_contract_import_sheets (
        id VARCHAR(36) PRIMARY KEY, import_record_id VARCHAR(36) NOT NULL, sheet_index INT NOT NULL,
        sheet_name VARCHAR(255) NOT NULL, start_row INT NOT NULL, start_col INT NOT NULL, row_count INT NOT NULL,
        column_count INT NOT NULL, header_row_no INT NULL, headers_json JSON NULL,
        is_contract_sheet BOOLEAN NOT NULL DEFAULT 0, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
    }
    if (!await adapter.tableExists('biz_contract_source_rows')) {
      await adapter.exec(`CREATE TABLE biz_contract_source_rows (
        id VARCHAR(36) PRIMARY KEY, import_record_id VARCHAR(36) NOT NULL, sheet_id VARCHAR(36) NOT NULL,
        source_row_no INT NOT NULL, row_kind VARCHAR(16) NOT NULL, cells_json JSON NOT NULL,
        normalization_status VARCHAR(16) NOT NULL DEFAULT 'archived', normalization_message TEXT NULL,
        province_id VARCHAR(36) NULL, city_id VARCHAR(36) NULL, contract_id VARCHAR(36) NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      )`);
    }
    const indexes = [
      ['biz_contract_import_records', 'uk_biz_contract_import_record_hash', 'file_hash', true],
      ['biz_contract_import_records', 'idx_biz_contract_import_record_uploaded', 'uploaded_at', false],
      ['biz_contract_import_records', 'idx_biz_contract_import_record_uploader', 'uploaded_by', false],
      ['biz_contract_import_sheets', 'uk_biz_contract_import_sheet_position', 'import_record_id, sheet_index', true],
      ['biz_contract_source_rows', 'uk_biz_contract_source_row_position', 'sheet_id, source_row_no', true],
      ['biz_contract_source_rows', 'idx_biz_contract_source_row_status', 'import_record_id, normalization_status', false],
    ];
    for (const [table, name, columns, unique] of indexes) {
      if (!await adapter.indexExists(table, name)) await adapter.exec(`CREATE ${unique ? 'UNIQUE ' : ''}INDEX ${name} ON ${table} (${columns})`);
    }
    return;
  }
  if (migration.version === '024_normalize_primary_contract_numbers') {
    if (!await adapter.tableExists('biz_contracts')) return;
    const rows = await adapter.rows('SELECT id, contract_no FROM biz_contracts ORDER BY id');
    const candidates = rows.map((row) => ({ id: String(row.id), current: String(row.contract_no), target: normalizePrimaryContractNumber(String(row.contract_no)) }));
    const currentOwners = new Map(rows.map((row) => [String(row.contract_no), String(row.id)]));
    const targetCounts = new Map();
    for (const candidate of candidates) targetCounts.set(candidate.target, (targetCounts.get(candidate.target) || 0) + 1);
    const conflicts = candidates.filter((candidate) => candidate.target && candidate.target !== candidate.current && ((currentOwners.has(candidate.target) && currentOwners.get(candidate.target) !== candidate.id) || targetCounts.get(candidate.target) > 1));
    if (conflicts.length) fail(`PRIMARY_CONTRACT_NO_CONFLICT ids=${conflicts.map((candidate) => candidate.id).join(',')}`);
    for (const candidate of candidates) {
      if (candidate.target && candidate.target !== candidate.current) {
        await adapter.exec(`UPDATE biz_contracts SET contract_no = ${quoteSqlLiteral(candidate.target)} WHERE id = ${quoteSqlLiteral(candidate.id)}`);
      }
    }
    return;
  }
  if (migration.version === '019_biz_admin_crud_permissions' && dialect === 'sqlite') {
    const permissions = [
      'operation.contract.allocate_cancel',
      'operation.order.batch_void',
      'operation.order.batch_restore',
      'operation.cost.create',
      'operation.cost.submit',
      'operation.cost.approve',
      'operation.cost.reject',
      'operation.cost.void',
    ];
    const contractManagerPermissions = [
      'operation.order.read',
      'operation.order.upload',
      'operation.order.batch_void',
      'operation.order.batch_restore',
      'operation.order.export',
      'operation.cost.read',
      'operation.cost.create',
      'operation.cost.submit',
      'operation.cost.approve',
      'operation.cost.reject',
      'operation.cost.void',
      'operation.cost.export',
    ];
    const roleIds = await adapter.rows("SELECT id, code FROM biz_roles WHERE code IN ('admin', 'contract_manager')");
    const permissionRows = await adapter.rows("SELECT code FROM biz_permissions");
    const known = new Set(permissionRows.map((row) => row.code));
    const statements = [];
    for (const role of roleIds) {
      const codes = role.code === 'admin' ? permissions : contractManagerPermissions;
      for (const code of codes) {
        if (!known.has(code)) continue;
        statements.push(`INSERT OR IGNORE INTO biz_role_permissions (id, role_id, permission_code) VALUES ('${randomUuidSqlite()}', '${role.id}', '${code}');`);
      }
    }
    if (statements.length) await adapter.exec(statements.join('\n'));
    return;
  }
  if (migration.version === '016_biz_offline_rate_snapshot') {
    const columns = [
      ['fee_rate_snapshot_bp', 'INT NULL'],
      ['gross_profit_fen', 'BIGINT NOT NULL DEFAULT 0'],
    ];
    for (const [column, definition] of columns) {
      if (!await adapter.columnExists('biz_offline_completions', column)) {
        await adapter.exec(`ALTER TABLE biz_offline_completions ADD COLUMN ${column} ${definition}`);
      }
    }
    return;
  }
  if (migration.version === '015_import_job_legacy_fields') {
    const columns = [
      ['source_file_base64', 'LONGTEXT NULL'],
      ['source_file_name', 'VARCHAR(255) NULL'],
      ['report_year', 'INT NULL'],
    ];
    for (const [column, definition] of columns) {
      if (!await adapter.columnExists('import_jobs', column)) {
        await adapter.exec(`ALTER TABLE import_jobs ADD COLUMN ${column} ${definition}`);
      }
    }
    return;
  }
  if (migration.version === '028_biz_fee_rate_import_tasks' && dialect === 'sqlite') {
    await adapter.exec(toSqlite(migration.sql));
    await adapter.exec(`CREATE INDEX IF NOT EXISTS idx_biz_fee_rate_task_operator ON biz_fee_rate_import_tasks (operator_user_id);
      CREATE INDEX IF NOT EXISTS idx_biz_fee_rate_task_created ON biz_fee_rate_import_tasks (created_at);
      CREATE INDEX IF NOT EXISTS idx_biz_fee_rate_row_task ON biz_fee_rate_import_task_rows (task_id);
      CREATE INDEX IF NOT EXISTS idx_biz_fee_rate_row_combo ON biz_fee_rate_import_task_rows (contract_id, city_id);`);
    return;
  }
  if (migration.version === '029_biz_account_scope_v2' && dialect === 'sqlite') {
    await adapter.exec(toSqlite(migration.sql.split(/\n\s*INSERT INTO/i)[0]));
    await adapter.exec(`CREATE INDEX IF NOT EXISTS idx_biz_user_role_user ON biz_user_roles (user_id);
      CREATE UNIQUE INDEX IF NOT EXISTS uk_biz_user_role ON biz_user_roles (user_id, role_code);
      CREATE INDEX IF NOT EXISTS idx_biz_user_scope_grant_user ON biz_user_scope_grants (user_id);
      CREATE INDEX IF NOT EXISTS idx_biz_user_scope_grant_target ON biz_user_scope_grants (scope_type, target_id);
      CREATE UNIQUE INDEX IF NOT EXISTS uk_biz_user_scope_grant ON biz_user_scope_grants (user_id, scope_type, target_id, effect);`);
    const users = await adapter.rows('SELECT id, role_code, city_id FROM biz_users');
    for (const user of users) {
      const role = String(user.role_code);
      if (!await adapter.scalar('SELECT COUNT(*) FROM biz_user_roles WHERE user_id = ? AND role_code = ?', [user.id, role])) {
        await adapter.exec(`INSERT INTO biz_user_roles (id, user_id, role_code, is_primary) VALUES (${quoteSqlLiteral(randomUuidSqlite())}, ${quoteSqlLiteral(user.id)}, ${quoteSqlLiteral(role)}, 1)`);
      }
      if (role === 'super_admin' && !await adapter.scalar("SELECT COUNT(*) FROM biz_user_scope_grants WHERE user_id = ? AND scope_type = 'all' AND effect = 'allow'", [user.id])) {
        await adapter.exec(`INSERT INTO biz_user_scope_grants (id, user_id, scope_type, target_id, effect) VALUES (${quoteSqlLiteral(randomUuidSqlite())}, ${quoteSqlLiteral(user.id)}, 'all', NULL, 'allow')`);
      }
      if (role === 'city_user' && user.city_id && !await adapter.scalar("SELECT COUNT(*) FROM biz_user_scope_grants WHERE user_id = ? AND scope_type = 'city' AND target_id = ? AND effect = 'allow'", [user.id, user.city_id])) {
        await adapter.exec(`INSERT INTO biz_user_scope_grants (id, user_id, scope_type, target_id, effect) VALUES (${quoteSqlLiteral(randomUuidSqlite())}, ${quoteSqlLiteral(user.id)}, 'city', ${quoteSqlLiteral(user.city_id)}, 'allow')`);
      }
      if (role === 'admin') {
        const scopes = await adapter.rows('SELECT province_id, city_id FROM biz_user_data_scopes WHERE user_id = ?', [user.id]);
        for (const scope of scopes) {
          const scopeType = scope.city_id ? 'city' : scope.province_id ? 'province' : 'all';
          const target = scope.city_id || scope.province_id || null;
          const exists = await adapter.scalar('SELECT COUNT(*) FROM biz_user_scope_grants WHERE user_id = ? AND scope_type = ? AND ((target_id = ?) OR (target_id IS NULL AND ? IS NULL)) AND effect = \'allow\'', [user.id, scopeType, target, target]);
          if (!exists) await adapter.exec(`INSERT INTO biz_user_scope_grants (id, user_id, scope_type, target_id, effect) VALUES (${quoteSqlLiteral(randomUuidSqlite())}, ${quoteSqlLiteral(user.id)}, ${quoteSqlLiteral(scopeType)}, ${target == null ? 'NULL' : quoteSqlLiteral(target)}, 'allow')`);
        }
        if (!await adapter.scalar('SELECT COUNT(*) FROM biz_user_scope_grants WHERE user_id = ?', [user.id])) await adapter.exec(`INSERT INTO biz_user_scope_grants (id, user_id, scope_type, target_id, effect) VALUES (${quoteSqlLiteral(randomUuidSqlite())}, ${quoteSqlLiteral(user.id)}, 'all', NULL, 'allow')`);
      }
    }
    return;
  }
  await adapter.exec(dialect === 'sqlite' ? toSqlite(migration.sql) : migration.sql);
}

async function inspectState(version) {
  const allOrNothing = async (checks) => {
    const values = await Promise.all(checks);
    if (values.every(Boolean)) return 'satisfied';
    if (values.every((value) => !value)) return 'empty';
    return 'partial';
  };
  if (version === '001_initial_tables') {
    return allOrNothing(['cities', 'users', 'contracts', 'contract_city_allocations', 'annual_report_packages', 'operation_logs'].map((table) => adapter.tableExists(table)));
  }
  if (version === '002_add_contract_month_invoice_order_amount') {
    if (!await adapter.tableExists('report_contract_monthly_rows')) return 'empty';
    return allOrNothing(['invoice_amount', 'order_amount'].map((column) => adapter.columnExists('report_contract_monthly_rows', column)));
  }
  if (version === '002_contract_city_business_metrics') return await adapter.tableExists('contract_city_business_metrics') ? 'satisfied' : 'empty';
  if (version === '003_seed_cities') {
    if (!await adapter.tableExists('cities')) return 'empty';
    return await adapter.scalar("SELECT COUNT(*) FROM cities WHERE code IN ('370100','370200','370300','370400','370500','370600','370700','370800','370900','371000','371100','371300','371400','371500','371600','371700')") === 16 ? 'satisfied' : 'empty';
  }
  if (version === '004_oa_city_soft_delete') {
    if (!await adapter.tableExists('cities')) return 'empty';
    return allOrNothing([adapter.columnExists('cities', 'is_deleted'), adapter.columnExists('cities', 'deleted_at'), adapter.indexExists('cities', 'idx_cities_deleted_sort')]);
  }
  if (version === '005_fact_data_foundation') {
    return allOrNothing(['fact_import_batches', 'fact_source_rows', 'cost_facts', 'order_facts', 'fact_versions'].map((table) => adapter.tableExists(table)));
  }
  if (version === '006_fact_source_file_lineage') {
    if (!await adapter.tableExists('fact_import_batches')) return 'empty';
    return allOrNothing([
      adapter.columnExists('fact_import_batches', 'source_file_storage_key'),
      adapter.columnExists('fact_import_batches', 'source_file_size'),
      adapter.columnExists('fact_import_batches', 'source_file_stored_at'),
      adapter.indexExists('fact_import_batches', 'idx_fact_batch_storage_key'),
    ]);
  }
  if (version === '007_rbac_auth') {
    if (!await adapter.tableExists('users')) return 'empty';
    const checks = [
      adapter.columnExists('users', 'auth_version'),
      adapter.columnExists('users', 'must_change_password'),
      adapter.indexExists('users', 'uk_users_single_root_admin'),
      adapter.tableExists('auth_wechat_invitations'),
    ];
    if (dialect === 'mysql') checks.push(adapter.columnExists('users', 'root_admin_singleton'));
    return allOrNothing(checks);
  }
  if (version === '008_v3_fact_lifecycle') {
    if (!await adapter.tableExists('fact_import_batches') || !await adapter.tableExists('fact_versions')) return 'empty';
    return allOrNothing([
      adapter.columnExists('fact_import_batches', 'lifecycle_status'), adapter.columnExists('fact_import_batches', 'warning_count'),
      adapter.columnExists('fact_import_batches', 'blocking_error_count'), adapter.columnExists('fact_import_batches', 'effective_at'),
      adapter.indexExists('fact_import_batches', 'idx_fact_batch_lifecycle'),
      adapter.columnExists('fact_versions', 'city_id'), adapter.columnExists('fact_versions', 'contract_id'),
      adapter.columnExists('fact_versions', 'period_year'), adapter.columnExists('fact_versions', 'period_month'),
      adapter.columnExists('fact_versions', 'lifecycle_status'), adapter.columnExists('fact_versions', 'supersedes_version_id'),
      adapter.columnExists('fact_versions', 'superseded_by_version_id'), adapter.columnExists('fact_versions', 'changed_fields_json'),
      adapter.columnExists('fact_versions', 'warning_summary_json'),
      adapter.indexExists('fact_versions', 'idx_fact_version_scope_status'), adapter.indexExists('fact_versions', 'idx_fact_version_fact_chain'),
    ]);
  }
  if (version === '009_production_governance') {
    if (!await adapter.tableExists('import_jobs')) return 'empty';
    return allOrNothing([
      adapter.columnExists('import_jobs', 'source_file_storage_key'),
      adapter.columnExists('import_jobs', 'source_file_sha256'),
      adapter.columnExists('import_jobs', 'source_file_size'),
      adapter.columnExists('import_jobs', 'source_file_stored_at'),
      adapter.columnExists('import_jobs', 'attempt_count'),
      adapter.columnExists('import_jobs', 'processing_started_at'),
      adapter.columnExists('import_jobs', 'failure_code'),
      adapter.indexExists('import_jobs', 'idx_import_jobs_status_started'),
      adapter.indexExists('import_jobs', 'idx_import_jobs_storage_key'),
      adapter.tableExists('auth_login_rate_limits'),
      adapter.tableExists('auth_security_events'),
    ]);
  }
  if (version === '010_biz_baseline_tables') {
    return allOrNothing([
      'biz_provinces', 'biz_cities', 'biz_users', 'biz_modules', 'biz_roles', 'biz_permissions',
      'biz_contracts', 'biz_contract_city_allocations', 'biz_contract_fee_rates', 'biz_contract_alerts',
      'biz_order_import_batches', 'biz_order_rows', 'biz_order_import_errors',
      'biz_offline_completions', 'biz_cost_entries', 'biz_cost_categories',
      'biz_monthly_aggregates', 'biz_aggregate_failures', 'biz_recalc_tasks', 'biz_messages',
      'biz_operation_logs',
    ].map((table) => adapter.tableExists(table)));
  }
  if (version === '011_biz_seed_main_data') {
    if (!await adapter.tableExists('biz_roles') || !await adapter.tableExists('biz_cities') || !await adapter.tableExists('biz_cost_categories')) return 'empty';
    return allOrNothing([
      adapter.scalar("SELECT COUNT(*) FROM biz_roles WHERE code IN ('super_admin','admin','contract_manager','city_user')").then((value) => value === 4),
      adapter.scalar("SELECT COUNT(*) FROM biz_cities WHERE code IN ('370100','370200','370300','370400','370500','370600','370700','370800','370900','371000','371100','371300','371400','371500','371600','371700')").then((value) => value === 16),
      adapter.scalar("SELECT COUNT(*) FROM biz_cost_categories WHERE code IN ('labor','utilities','fuel','entertainment','rent','reimbursement','other')").then((value) => value === 7),
    ]);
  }
  if (version === '012_biz_permission_seed') {
    if (!await adapter.tableExists('biz_permissions') || !await adapter.tableExists('biz_role_permissions')) return 'empty';
    return allOrNothing([
      adapter.scalar("SELECT COUNT(*) FROM biz_permissions").then((value) => value >= 39),
      adapter.scalar("SELECT COUNT(*) FROM biz_role_permissions").then((value) => value >= 48),
      adapter.scalar("SELECT COUNT(*) FROM biz_role_permissions WHERE role_id = (SELECT id FROM biz_roles WHERE code = 'city_user')").then((value) => value === 16),
    ]);
  }
  if (version === '013_biz_order_temp_file') {
    if (!await adapter.tableExists('biz_order_import_batches')) return 'empty';
    return allOrNothing([
      adapter.columnExists('biz_order_import_batches', 'temp_file_path'),
    ]);
  }
  if (version === '014_biz_system_settings') {
    if (!await adapter.tableExists('biz_system_settings')) return 'empty';
    return allOrNothing([
      adapter.scalar("SELECT COUNT(*) FROM biz_system_settings WHERE setting_key IN ('contract_expiry_warning_days','order_import_max_rows','order_import_max_bytes')").then((value) => value === 3),
    ]);
  }
  if (version === '015_import_job_legacy_fields') {
    if (!await adapter.tableExists('import_jobs')) return 'empty';
    return allOrNothing([
      adapter.columnExists('import_jobs', 'source_file_base64'),
      adapter.columnExists('import_jobs', 'source_file_name'),
      adapter.columnExists('import_jobs', 'report_year'),
    ]);
  }
  if (version === '016_biz_offline_rate_snapshot') {
    if (!await adapter.tableExists('biz_offline_completions')) return 'empty';
    return allOrNothing([
      adapter.columnExists('biz_offline_completions', 'fee_rate_snapshot_bp'),
      adapter.columnExists('biz_offline_completions', 'gross_profit_fen'),
    ]);
  }
  if (version === '017_biz_order_batch_scope') {
    if (!await adapter.tableExists('biz_order_import_batches')) return 'empty';
    return allOrNothing([
      adapter.columnExists('biz_order_import_batches', 'data_scope_json'),
    ]);
  }
  if (version === '018_biz_order_row_validation') {
    if (!await adapter.tableExists('biz_order_rows')) return 'empty';
    return allOrNothing([
      adapter.columnExists('biz_order_rows', 'validation_status'),
      adapter.columnExists('biz_order_rows', 'validation_error'),
    ]);
  }
  if (version === '019_biz_admin_crud_permissions') {
    if (!await adapter.tableExists('biz_role_permissions')) return 'empty';
    return adapter.scalar(`SELECT COUNT(*) FROM biz_role_permissions rp
      JOIN biz_roles r ON r.id = rp.role_id
      WHERE r.code IN ('admin', 'contract_manager')
        AND rp.permission_code IN (
          'operation.contract.allocate_cancel',
          'operation.order.batch_void',
          'operation.order.batch_restore',
          'operation.cost.create',
          'operation.cost.submit',
          'operation.cost.approve',
          'operation.cost.reject',
          'operation.cost.void'
        )`).then((count) => count >= 8 ? 'satisfied' : 'empty');
  }
  if (version === '020_biz_contract_soft_delete_op_log') {
    if (!await adapter.tableExists('biz_contracts') || !await adapter.tableExists('biz_operation_logs')) return 'empty';
    return allOrNothing([
      adapter.columnExists('biz_contracts', 'deleted_at'),
      adapter.columnExists('biz_contracts', 'deleted_by'),
      adapter.columnExists('biz_contracts', 'deleted_batch_id'),
      adapter.columnExists('biz_operation_logs', 'summary_before'),
      adapter.columnExists('biz_operation_logs', 'summary_after'),
      adapter.columnExists('biz_operation_logs', 'batch_id'),
      adapter.columnExists('biz_operation_logs', 'error_message'),
      adapter.indexExists('biz_contracts', 'idx_biz_contracts_deleted'),
      adapter.indexExists('biz_operation_logs', 'idx_biz_op_log_batch'),
    ]);
  }
  if (version === '021_biz_contract_permissions') {
    if (!await adapter.tableExists('biz_permissions') || !await adapter.tableExists('biz_role_permissions')) return 'empty';
    const newCodes = `'operation.contract.delete','operation.contract.batch_read','operation.contract.batch_create','operation.contract.batch_update','operation.contract.batch_delete','operation.contract.restore'`;
    const permOk = await adapter.scalar(`SELECT COUNT(*) FROM biz_permissions WHERE code IN (${newCodes})`).then((c) => c >= 6);
    const roleOk = await adapter.scalar(`SELECT COUNT(*) FROM biz_role_permissions rp
      JOIN biz_roles r ON r.id = rp.role_id
      WHERE r.code IN ('admin', 'contract_manager') AND rp.permission_code IN (${newCodes})`).then((c) => c >= 12);
    return permOk && roleOk ? 'satisfied' : 'empty';
  }
  if (version === '022_biz_province_branch_order_corrections') {
    if (!await adapter.tableExists('biz_cities') || !await adapter.tableExists('biz_order_import_batches') || !await adapter.tableExists('biz_order_rows')) return 'empty';
    const columnsOk = await Promise.all([
      adapter.columnExists('biz_cities', 'unit_type'),
      adapter.columnExists('biz_order_import_batches', 'source_batch_id'),
      adapter.columnExists('biz_order_import_batches', 'batch_purpose'),
      adapter.columnExists('biz_order_rows', 'replaces_order_row_id'),
      adapter.columnExists('biz_order_rows', 'resolved_by_batch_id'),
      adapter.columnExists('biz_order_rows', 'resolved_by_user_id'),
      adapter.columnExists('biz_order_rows', 'resolved_at'),
      adapter.indexExists('biz_order_import_batches', 'idx_biz_order_batch_source'),
      adapter.indexExists('biz_order_rows', 'idx_biz_order_row_replaces'),
      adapter.indexExists('biz_order_rows', 'uk_biz_order_row_replaces'),
      adapter.indexExists('biz_order_rows', 'idx_biz_order_row_resolved_batch'),
    ]);
    if (!columnsOk.every(Boolean)) return 'empty';
    if (!await adapter.tableExists('biz_city_aliases')) return 'empty';
    const branchOk = await adapter.scalar("SELECT COUNT(*) FROM biz_cities WHERE code = '370000-BRANCH' AND unit_type = 'province_branch'").then((count) => count === 1);
    const aliasesOk = await adapter.scalar("SELECT COUNT(*) FROM biz_city_aliases WHERE city_id = '00000000-0000-4000-8000-000000000117'").then((count) => count >= 5);
    return branchOk && aliasesOk ? 'satisfied' : 'empty';
  }
  if (version === '023_biz_contract_import_records') {
    if (!await adapter.tableExists('biz_contracts')) return 'empty';
    return allOrNothing([
      ...['archive_contract_no', 'project_identity_code', 'contract_category_1', 'contract_category_2', 'winning_project_name', 'signed_date', 'tax_rate_raw', 'tax_rate_bp', 'tax_rate_bps_json', 'source_import_record_id', 'source_sheet_id', 'source_row_id', 'source_row_no'].map((column) => adapter.columnExists('biz_contracts', column)),
      adapter.indexExists('biz_contracts', 'idx_biz_contracts_source_import'),
      adapter.tableExists('biz_contract_import_records'), adapter.tableExists('biz_contract_import_sheets'), adapter.tableExists('biz_contract_source_rows'),
      adapter.indexExists('biz_contract_import_records', 'uk_biz_contract_import_record_hash'),
      adapter.indexExists('biz_contract_import_sheets', 'uk_biz_contract_import_sheet_position'),
      adapter.indexExists('biz_contract_source_rows', 'uk_biz_contract_source_row_position'),
    ]);
  }
  if (version === '024_normalize_primary_contract_numbers') {
    if (!await adapter.tableExists('biz_contracts')) return 'empty';
    const rows = await adapter.rows('SELECT contract_no FROM biz_contracts');
    return rows.every((row) => normalizePrimaryContractNumber(String(row.contract_no)) === String(row.contract_no)) ? 'satisfied' : 'empty';
  }
  if (version === '025_biz_messages_announcements') {
    if (!await adapter.tableExists('biz_announcements') || !await adapter.tableExists('biz_announcement_reads')) return 'empty';
    return allOrNothing([
      adapter.indexExists('biz_announcements', 'idx_biz_announcement_status_time'),
      adapter.indexExists('biz_announcements', 'idx_biz_announcement_scope'),
      adapter.indexExists('biz_announcements', 'idx_biz_announcement_creator'),
      adapter.indexExists('biz_announcement_reads', 'uk_biz_announcement_read'),
      adapter.indexExists('biz_announcement_reads', 'idx_biz_announcement_read_user'),
      adapter.scalar("SELECT COUNT(*) FROM biz_permissions WHERE code IN ('operation.message.read','operation.announcement.create','operation.announcement.publish','operation.announcement.manage')").then((count) => count === 4),
    ]);
  }
  if (version === '026_biz_region_permissions') {
    if (!await adapter.tableExists('biz_permissions') || !await adapter.tableExists('biz_role_permissions')) return 'empty';
    const permOk = await adapter.scalar("SELECT COUNT(*) FROM biz_permissions WHERE code = 'operation.region.manage'").then((count) => count >= 1);
    const roleOk = await adapter.scalar("SELECT COUNT(*) FROM biz_role_permissions WHERE permission_code = 'operation.region.manage'").then((count) => count >= 1);
    return permOk && roleOk ? 'satisfied' : 'empty';
  }
  if (version === '027_snapshot_auto_update_settings') {
    if (!await adapter.tableExists('biz_system_settings')) return 'empty';
    return adapter.scalar("SELECT COUNT(*) FROM biz_system_settings WHERE setting_key IN ('snapshot_auto_update_enabled','snapshot_auto_update_time')")
      .then((count) => count === 2 ? 'satisfied' : 'empty');
  }
  if (version === '028_biz_fee_rate_import_tasks') {
    return allOrNothing([
      adapter.tableExists('biz_fee_rate_import_tasks'),
      adapter.tableExists('biz_fee_rate_import_task_rows'),
      adapter.indexExists('biz_fee_rate_import_tasks', 'idx_biz_fee_rate_task_operator'),
      adapter.indexExists('biz_fee_rate_import_tasks', 'idx_biz_fee_rate_task_created'),
      adapter.indexExists('biz_fee_rate_import_task_rows', 'idx_biz_fee_rate_row_task'),
      adapter.indexExists('biz_fee_rate_import_task_rows', 'idx_biz_fee_rate_row_combo'),
    ]);
  }
  if (version === '029_biz_account_scope_v2') {
    return allOrNothing([
      adapter.tableExists('biz_user_roles'),
      adapter.tableExists('biz_user_scope_grants'),
      adapter.indexExists('biz_user_roles', 'uk_biz_user_role'),
      adapter.indexExists('biz_user_scope_grants', 'uk_biz_user_scope_grant'),
      adapter.indexExists('biz_user_scope_grants', 'idx_biz_user_scope_grant_target'),
    ]);
  }
  if (version === '030_order_snapshot') {
    return allOrNothing([
      adapter.columnExists('biz_order_rows', 'is_current'),
      adapter.columnExists('biz_order_import_batches', 'lifecycle_status'),
      adapter.indexExists('biz_order_rows', 'idx_order_current'),
      adapter.tableExists('biz_order_snapshot_lock'),
    ]);
  }
  if (version === '031_order_upload_parts') {
    return allOrNothing([
      adapter.tableExists('biz_order_upload_parts'),
      adapter.indexExists('biz_order_upload_parts', 'idx_order_upload_created'),
    ]);
  }
  if (version === '032_maintenance_personnel') {
    return allOrNothing([
      adapter.tableExists('maintenance_personnel'),
      adapter.indexExists('maintenance_personnel', 'idx_maintenance_personnel_org_status'),
      adapter.columnExists('maintenance_personnel', 'personnel_code'),
      adapter.columnExists('maintenance_personnel', 'org_company'),
      adapter.columnExists('maintenance_personnel', 'org_region'),
    ]);
  }
  if (version === '033_maintenance_vehicle_generator') {
    return allOrNothing([
      adapter.tableExists('maintenance_vehicles'),
      adapter.tableExists('maintenance_generators'),
      adapter.columnExists('maintenance_vehicles', 'plate_number'),
      adapter.columnExists('maintenance_generators', 'generator_code'),
    ]);
  }
  if (version === '034_maintenance_detail_fields') {
    return allOrNothing([
      adapter.columnExists('maintenance_personnel', 'id_card'),
      adapter.columnExists('maintenance_personnel', 'team_accident_policy_no3'),
      adapter.columnExists('maintenance_vehicles', 'driving_license'),
      adapter.columnExists('maintenance_vehicles', 'commercial_insurance_policy_no'),
      adapter.columnExists('maintenance_generators', 'manufacturer'),
      adapter.columnExists('maintenance_generators', 'last_maintenance_upload_at'),
    ]);
  }
  if (version === '035_maintenance_org_city') {
    return allOrNothing([
      adapter.columnExists('maintenance_personnel', 'org_city'),
      adapter.columnExists('maintenance_vehicles', 'org_city'),
      adapter.columnExists('maintenance_generators', 'org_city'),
    ]);
  }
  if (version === '036_maintenance_data_delete_permission') {
    if (!await adapter.tableExists('biz_permissions')) return 'empty';
    return adapter.scalar("SELECT COUNT(*) FROM biz_permissions WHERE code = 'maintenance.data.delete'").then((count) => count >= 1 ? 'satisfied' : 'empty');
  }
  if (version === '037_maintenance_document_files') {
    return allOrNothing([
      adapter.tableExists('maintenance_document_files'),
      adapter.indexExists('maintenance_document_files', 'idx_maintenance_document_owner'),
      adapter.indexExists('maintenance_document_files', 'idx_maintenance_document_uploader'),
    ]);
  }
  if (version === '038_performance') {
    return allOrNothing([adapter.tableExists('biz_performance_batch'), adapter.tableExists('biz_performance_record'), adapter.indexExists('biz_performance_record', 'uk_perf_batch_supplier_org')]);
  }
  if (version === '039_order_rows_covering_index') {
    if (!await adapter.tableExists('biz_order_rows')) return 'empty';
    return await adapter.indexExists('biz_order_rows', 'idx_order_scope_cover') ? 'satisfied' : 'empty';
  }
  if (version === '040_biz_assessment') {
    // 只检查本迁移新建的两张表与唯一索引：biz_permissions / biz_role_permissions 由 010/012 建，
    // 放在这里会让全新库被判成 partial；权限种子本身可重复执行，无需参与状态判定。
    return allOrNothing([
      adapter.tableExists('biz_assessment_batch'),
      adapter.tableExists('biz_assessment_record'),
      adapter.indexExists('biz_assessment_record', 'uk_biz_assessment_dedup'),
    ]);
  }
  if (version === '041_biz_liaoning_regions') {
    // 只检查本迁移新增的数据：辽宁省 + 14 个地市
    if (!await adapter.tableExists('biz_provinces') || !await adapter.tableExists('biz_cities')) return 'empty';
    const provinceOk = await adapter.scalar("SELECT COUNT(*) FROM biz_provinces WHERE code = '210000'").then((count) => count === 1);
    if (!provinceOk) return 'empty';
    return await adapter.scalar("SELECT COUNT(*) FROM biz_cities WHERE province_id = '00000000-0000-4000-8000-000000000031'").then((count) => count === 14 ? 'satisfied' : 'empty');
  }
  if (version === '042_biz_liaoning_orphan_fix') {
    // 判据：不存在 province_id 指向缺失省份的孤儿地市
    if (!await adapter.tableExists('biz_cities') || !await adapter.tableExists('biz_provinces')) return 'empty';
    return await adapter.scalar('SELECT COUNT(*) FROM biz_cities c LEFT JOIN biz_provinces p ON p.id = c.province_id WHERE p.id IS NULL')
      .then((count) => count === 0 ? 'satisfied' : 'empty');
  }
  fail(`STATE_CHECK_MISSING version=${version}`);
}

async function canRepairMaintenanceDetailFields() {
  return (await Promise.all([
    adapter.tableExists('maintenance_personnel'),
    adapter.tableExists('maintenance_vehicles'),
    adapter.tableExists('maintenance_generators'),
  ])).every(Boolean);
}

async function applyMaintenanceDetailFields() {
  const columns = [
    ['maintenance_personnel', 'id_card', 'VARCHAR(32) NULL'],
    ['maintenance_personnel', 'low_voltage_cert', 'VARCHAR(160) NULL'],
    ['maintenance_personnel', 'low_voltage_cert_expiry', 'VARCHAR(64) NULL'],
    ['maintenance_personnel', 'high_voltage_cert', 'VARCHAR(160) NULL'],
    ['maintenance_personnel', 'high_voltage_cert_expiry', 'VARCHAR(64) NULL'],
    ['maintenance_personnel', 'work_at_height_cert', 'VARCHAR(160) NULL'],
    ['maintenance_personnel', 'work_at_height_cert_expiry', 'VARCHAR(64) NULL'],
    ['maintenance_personnel', 'employer_liability_amount', 'VARCHAR(64) NULL'],
    ['maintenance_personnel', 'employer_liability_policy_no', 'VARCHAR(160) NULL'],
    ['maintenance_personnel', 'employer_liability_expiry', 'VARCHAR(64) NULL'],
    ['maintenance_personnel', 'team_accident_amount', 'VARCHAR(64) NULL'],
    ['maintenance_personnel', 'team_accident_policy_no', 'VARCHAR(160) NULL'],
    ['maintenance_personnel', 'team_accident_expiry', 'VARCHAR(64) NULL'],
    ['maintenance_personnel', 'team_accident_amount2', 'VARCHAR(64) NULL'],
    ['maintenance_personnel', 'team_accident_policy_no2', 'VARCHAR(160) NULL'],
    ['maintenance_personnel', 'team_accident_expiry2', 'VARCHAR(64) NULL'],
    ['maintenance_personnel', 'team_accident_amount3', 'VARCHAR(64) NULL'],
    ['maintenance_personnel', 'team_accident_policy_no3', 'VARCHAR(160) NULL'],
    ['maintenance_personnel', 'team_accident_expiry3', 'VARCHAR(64) NULL'],
    ['maintenance_personnel', 'personnel_condition', 'VARCHAR(255) NULL'],
    ['maintenance_vehicles', 'owner_name', 'VARCHAR(100) NULL'],
    ['maintenance_vehicles', 'driving_license', 'VARCHAR(160) NULL'],
    ['maintenance_vehicles', 'vehicle_years', 'VARCHAR(64) NULL'],
    ['maintenance_vehicles', 'mileage', 'VARCHAR(64) NULL'],
    ['maintenance_vehicles', 'vehicle_status', 'VARCHAR(64) NULL'],
    ['maintenance_vehicles', 'compulsory_insurance_policy_no', 'VARCHAR(160) NULL'],
    ['maintenance_vehicles', 'compulsory_insurance_expiry', 'VARCHAR(64) NULL'],
    ['maintenance_vehicles', 'commercial_insurance_policy_no', 'VARCHAR(160) NULL'],
    ['maintenance_vehicles', 'commercial_insurance_expiry', 'VARCHAR(64) NULL'],
    ['maintenance_vehicles', 'maintenance_time', 'VARCHAR(64) NULL'],
    ['maintenance_generators', 'manufacturer', 'VARCHAR(255) NULL'],
    ['maintenance_generators', 'production_date', 'VARCHAR(64) NULL'],
    ['maintenance_generators', 'last_maintenance_upload_at', 'VARCHAR(64) NULL'],
  ];
  for (const [table, column, definition] of columns) {
    if (!await adapter.columnExists(table, column)) {
      await adapter.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
}

function validateConfiguration(checkRuntime = true) {
  if (checkRuntime && String(process.env.NODE_ENV).toLowerCase() === 'production' && String(process.env.DB_SYNC).toLowerCase() !== 'false') {
    fail('PRODUCTION_DB_SYNC_MUST_BE_FALSE');
  }
  if (!migrations.length) fail('NO_MIGRATIONS_FOUND');
  const versions = new Set();
  for (const migration of migrations) {
    if (versions.has(migration.version)) fail(`DUPLICATE_VERSION version=${migration.version}`);
    versions.add(migration.version);
  }
}

function checkMigrationFiles() {
  validateConfiguration(false);
  const checksumManifestPath = path.join(repoRoot, 'scripts', 'db', 'migration-checksums.json');
  if (!fs.existsSync(checksumManifestPath)) fail('MIGRATION_CHECKSUM_MANIFEST_MISSING');
  const checksumManifest = JSON.parse(fs.readFileSync(checksumManifestPath, 'utf8'));
  const required = [
    '001_initial_tables', '002_add_contract_month_invoice_order_amount', '002_contract_city_business_metrics',
    '003_seed_cities', '004_oa_city_soft_delete', '005_fact_data_foundation', '006_fact_source_file_lineage',
    '007_rbac_auth', '008_v3_fact_lifecycle', '009_production_governance',
  ];
  for (const version of required) if (!migrations.some((migration) => migration.version === version)) fail(`MIGRATION_MISSING version=${version}`);
  for (const migration of migrations) {
    if (!/^(CREATE|ALTER|INSERT|SET|--)/m.test(migration.sql.trim())) fail(`SQL_UNRECOGNIZED file=${migration.filename}`);
    if (!checksumManifest[migration.version]) fail(`MIGRATION_CHECKSUM_UNPINNED version=${migration.version}`);
    if (checksumManifest[migration.version] !== migration.checksum) {
      fail(`MIGRATION_FILE_CHECKSUM_DRIFT version=${migration.version} expected=${checksumManifest[migration.version]} actual=${migration.checksum}`);
    }
    console.log(`MIGRATION_FILE version=${migration.version} checksum=${migration.checksum.slice(0, 12)}`);
  }
  for (const version of Object.keys(checksumManifest)) {
    if (!migrations.some((migration) => migration.version === version)) fail(`MIGRATION_MANIFEST_ORPHAN version=${version}`);
  }
  console.log(`MIGRATION_FILES_OK migrations=${migrations.length} scope=list_and_basic_format_only`);
}

async function ensureLedger() {
  await adapter.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(190) PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    checksum VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    execution_mode VARCHAR(32) NULL,
    execution_ms INT NULL,
    error_message TEXT NULL,
    applied_at DATETIME NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
}

async function loadLedger() {
  if (!await adapter.tableExists('schema_migrations')) return [];
  return adapter.rows('SELECT version, filename, checksum, status, execution_mode, execution_ms, error_message, applied_at FROM schema_migrations ORDER BY version');
}

async function recordStarting(migration) {
  await adapter.upsertLedger({ ...migration, status: 'applying', executionMode: null, executionMs: null, errorMessage: null, appliedAt: null });
}
async function recordApplied(migration, executionMode, executionMs) {
  await adapter.upsertLedger({ ...migration, status: 'applied', executionMode, executionMs, errorMessage: null, appliedAt: new Date() });
}
async function recordFailed(migration, error) {
  await adapter.upsertLedger({ ...migration, status: 'failed', executionMode: 'executed', executionMs: null, errorMessage: clean(error instanceof Error ? error.message : error), appliedAt: null });
}

function openSqlite() {
  const Database = requireFromApi('better-sqlite3');
  const configured = process.env.DB_DATABASE;
  if (!configured) fail('SQLITE_DATABASE_REQUIRED');
  const databasePath = path.isAbsolute(configured) ? configured : path.resolve(apiRoot, configured);
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');
  return {
    exec: async (sql) => db.exec(sql),
    rows: async (sql, params = []) => db.prepare(sql).all(...params),
    scalar: async (sql, params = []) => Number(db.prepare(sql).pluck().get(...params) || 0),
    tableExists: async (table) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)),
    columnExists: async (table, column) => Boolean(db.prepare(`PRAGMA table_info(${quoteIdentifier(table)})`).all().some((item) => item.name === column)),
    indexExists: async (table, index) => Boolean(db.prepare(`PRAGMA index_list(${quoteIdentifier(table)})`).all().some((item) => item.name === index)),
    upsertLedger: async (row) => db.prepare(`INSERT INTO schema_migrations (version, filename, checksum, status, execution_mode, execution_ms, error_message, applied_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(version) DO UPDATE SET filename=excluded.filename, checksum=excluded.checksum, status=excluded.status,
      execution_mode=excluded.execution_mode, execution_ms=excluded.execution_ms, error_message=excluded.error_message,
      applied_at=excluded.applied_at, updated_at=CURRENT_TIMESTAMP`).run(row.version, row.filename, row.checksum, row.status, row.executionMode, row.executionMs, row.errorMessage, row.appliedAt?.toISOString() ?? null),
    close: async () => db.close(),
  };
}

async function openMysql() {
  if (!process.env.DB_DATABASE) fail('MYSQL_DATABASE_REQUIRED');
  const mysql = requireFromApi('mysql2/promise');
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USERNAME || 'root', password: process.env.DB_PASSWORD || '',
    database: process.env.DB_DATABASE, multipleStatements: true,
  });
  // 运行环境表（非业务迁移）：TypeORM MySQL 驱动初始化需要 typeorm_metadata
  await connection.query("CREATE TABLE IF NOT EXISTS `typeorm_metadata` (\n  `type` varchar(64) NOT NULL,\n  `database` varchar(64) NOT NULL DEFAULT '',\n  `schema` varchar(64) NOT NULL DEFAULT '',\n  `table` varchar(64) NOT NULL DEFAULT '',\n  `name` varchar(64) NOT NULL DEFAULT '',\n  `value` text,\n  PRIMARY KEY (`type`,`database`,`schema`,`table`,`name`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
  const scalarMysql = async (sql, params) => {
    const [rows] = await connection.query(sql, params);
    return Number(Object.values(rows[0] || {})[0] || 0);
  };
  return {
    exec: async (sql) => { await connection.query(sql); },
    rows: async (sql, params = []) => (await connection.query(sql, params))[0],
    scalar: scalarMysql,
    tableExists: async (table) => Boolean(await scalarMysql('SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?', [table])),
    columnExists: async (table, column) => Boolean(await scalarMysql('SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?', [table, column])),
    indexExists: async (table, index) => Boolean(await scalarMysql('SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?', [table, index])),
    upsertLedger: async (row) => connection.execute(`INSERT INTO schema_migrations (version, filename, checksum, status, execution_mode, execution_ms, error_message, applied_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON DUPLICATE KEY UPDATE filename=VALUES(filename), checksum=VALUES(checksum), status=VALUES(status), execution_mode=VALUES(execution_mode),
      execution_ms=VALUES(execution_ms), error_message=VALUES(error_message), applied_at=VALUES(applied_at), updated_at=CURRENT_TIMESTAMP`,
    [row.version, row.filename, row.checksum, row.status, row.executionMode, row.executionMs, row.errorMessage, row.appliedAt]),
    close: async () => connection.end(),
  };
}

async function applySqliteV3FactLifecycle() {
  const batchColumns = [
    ['lifecycle_status', "VARCHAR(32) NOT NULL DEFAULT 'processing'"], ['warning_count', 'INT NOT NULL DEFAULT 0'],
    ['blocking_error_count', 'INT NOT NULL DEFAULT 0'], ['effective_at', 'DATETIME NULL'],
  ];
  for (const [column, definition] of batchColumns) {
    if (!await adapter.columnExists('fact_import_batches', column)) await adapter.exec('ALTER TABLE fact_import_batches ADD COLUMN ' + column + ' ' + definition);
  }
  await adapter.exec(`UPDATE fact_import_batches SET lifecycle_status = CASE WHEN status = 'completed' THEN 'current_effective' WHEN status = 'failed' THEN 'validation_failed' ELSE 'processing' END, blocking_error_count = CASE WHEN status = 'failed' THEN error_rows ELSE 0 END, effective_at = CASE WHEN status = 'completed' THEN completed_at ELSE NULL END`);
  if (!await adapter.indexExists('fact_import_batches', 'idx_fact_batch_lifecycle')) await adapter.exec('CREATE INDEX idx_fact_batch_lifecycle ON fact_import_batches (city_id, fact_kind, lifecycle_status, created_at)');
  const versionColumns = [
    ['city_id', 'BIGINT NULL'], ['contract_id', 'BIGINT NULL'], ['period_year', 'INT NULL'], ['period_month', 'TINYINT NULL'],
    ['lifecycle_status', "VARCHAR(32) NOT NULL DEFAULT 'current_effective'"], ['supersedes_version_id', 'BIGINT NULL'],
    ['superseded_by_version_id', 'BIGINT NULL'], ['changed_fields_json', 'JSON NULL'], ['warning_summary_json', 'JSON NULL'],
  ];
  for (const [column, definition] of versionColumns) {
    if (!await adapter.columnExists('fact_versions', column)) await adapter.exec('ALTER TABLE fact_versions ADD COLUMN ' + column + ' ' + definition);
  }
  await adapter.exec(`UPDATE fact_versions SET
    city_id = COALESCE((SELECT city_id FROM cost_facts WHERE fact_versions.fact_type = 'cost' AND cost_facts.id = fact_versions.fact_id), (SELECT city_id FROM order_facts WHERE fact_versions.fact_type = 'order' AND order_facts.id = fact_versions.fact_id)),
    contract_id = COALESCE((SELECT contract_id FROM cost_facts WHERE fact_versions.fact_type = 'cost' AND cost_facts.id = fact_versions.fact_id), (SELECT contract_id FROM order_facts WHERE fact_versions.fact_type = 'order' AND order_facts.id = fact_versions.fact_id)),
    period_year = COALESCE((SELECT period_year FROM cost_facts WHERE fact_versions.fact_type = 'cost' AND cost_facts.id = fact_versions.fact_id), (SELECT period_year FROM order_facts WHERE fact_versions.fact_type = 'order' AND order_facts.id = fact_versions.fact_id)),
    period_month = COALESCE((SELECT period_month FROM cost_facts WHERE fact_versions.fact_type = 'cost' AND cost_facts.id = fact_versions.fact_id), (SELECT period_month FROM order_facts WHERE fact_versions.fact_type = 'order' AND order_facts.id = fact_versions.fact_id)),
    lifecycle_status = CASE WHEN version_no = (SELECT MAX(v2.version_no) FROM fact_versions v2 WHERE v2.fact_type = fact_versions.fact_type AND v2.fact_id = fact_versions.fact_id) THEN 'current_effective' ELSE 'replaced' END`);
  await adapter.exec(`UPDATE fact_versions AS current_version SET supersedes_version_id = (SELECT previous_version.id FROM fact_versions previous_version WHERE previous_version.fact_type = current_version.fact_type AND previous_version.fact_id = current_version.fact_id AND previous_version.version_no = current_version.version_no - 1), superseded_by_version_id = (SELECT next_version.id FROM fact_versions next_version WHERE next_version.fact_type = current_version.fact_type AND next_version.fact_id = current_version.fact_id AND next_version.version_no = current_version.version_no + 1)`);
  if (!await adapter.indexExists('fact_versions', 'idx_fact_version_scope_status')) await adapter.exec('CREATE INDEX idx_fact_version_scope_status ON fact_versions (city_id, lifecycle_status, created_at)');
  if (!await adapter.indexExists('fact_versions', 'idx_fact_version_fact_chain')) await adapter.exec('CREATE INDEX idx_fact_version_fact_chain ON fact_versions (fact_type, fact_id, version_no)');
}
async function applySqliteProductionGovernance() {
  const importColumns = [
    ['source_file_storage_key', 'VARCHAR(500) NULL'],
    ['source_file_sha256', 'VARCHAR(64) NULL'],
    ['source_file_size', 'BIGINT NULL'],
    ['source_file_stored_at', 'DATETIME NULL'],
    ['attempt_count', 'INT NOT NULL DEFAULT 0'],
    ['processing_started_at', 'DATETIME NULL'],
    ['failure_code', 'VARCHAR(64) NULL'],
  ];
  for (const [column, definition] of importColumns) {
    if (!await adapter.columnExists('import_jobs', column)) {
      await adapter.exec(`ALTER TABLE import_jobs ADD COLUMN ${column} ${definition}`);
    }
  }
  if (!await adapter.indexExists('import_jobs', 'idx_import_jobs_status_started')) {
    await adapter.exec('CREATE INDEX idx_import_jobs_status_started ON import_jobs (status, processing_started_at)');
  }
  if (!await adapter.indexExists('import_jobs', 'idx_import_jobs_storage_key')) {
    await adapter.exec('CREATE INDEX idx_import_jobs_storage_key ON import_jobs (source_file_storage_key)');
  }
  if (!await adapter.tableExists('auth_login_rate_limits')) {
    await adapter.exec(sqliteAuthLoginRateLimits());
  }
  if (!await adapter.tableExists('auth_security_events')) {
    await adapter.exec(sqliteAuthSecurityEvents());
  }
}
function toSqlite(sql) {
  const output = [];
  for (let line of sql.replace(/^\uFEFF/, '').replace(/\r/g, '').split('\n')) {
    if (/^\s*SET\s+/i.test(line) || /^\s*KEY\s+/i.test(line)) continue;
    line = line.replace(/BIGINT\s+PRIMARY\s+KEY\s+AUTO_INCREMENT/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT');
    line = line.replace(/TINYINT\s*\(\s*1\s*\)/gi, 'INTEGER').replace(/\bBIGINT\b/gi, 'INTEGER').replace(/\bTINYINT\b/gi, 'INTEGER');
    line = line.replace(/\s+ON\s+UPDATE\s+CURRENT_TIMESTAMP/gi, '');
    line = line.replace(/^\s*UNIQUE\s+KEY\s+\w+\s*\((.+)\)(,?)\s*$/i, '  UNIQUE ($1)$2');
    line = line.replace(/\)\s*ENGINE=InnoDB[^;]*;/i, ');');
    output.push(line);
  }
  return output.join('\n').replace(/,\s*\n\s*\);/g, '\n);');
}

function sqliteSeedCities() {
  const cities = [
    ['济南','370100',1],['青岛','370200',2],['淄博','370300',3],['枣庄','370400',4],
    ['东营','370500',5],['烟台','370600',6],['潍坊','370700',7],['济宁','370800',8],
    ['泰安','370900',9],['威海','371000',10],['日照','371100',11],['临沂','371300',12],
    ['德州','371400',13],['聊城','371500',14],['滨州','371600',15],['菏泽','371700',16],
  ];
  return cities.map(([name, code, order]) => `INSERT INTO cities (name, code, sort_order) VALUES ('${name}', '${code}', ${order}) ON CONFLICT(name) DO UPDATE SET code=excluded.code, sort_order=excluded.sort_order;`).join('\n');
}

function mysqlWechatInvitations() {
  return `CREATE TABLE auth_wechat_invitations (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id BIGINT NOT NULL,
    token_hash VARCHAR(64) NOT NULL,
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,
    created_by BIGINT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_auth_wechat_invitation_token_hash (token_hash),
    KEY idx_auth_wechat_invitation_user (user_id),
    KEY idx_auth_wechat_invitation_expiry (expires_at, used_at),
    CONSTRAINT fk_auth_wechat_invitation_user FOREIGN KEY (user_id) REFERENCES users (id),
    CONSTRAINT fk_auth_wechat_invitation_creator FOREIGN KEY (created_by) REFERENCES users (id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`;
}

function sqliteWechatInvitations() {
  return `CREATE TABLE auth_wechat_invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,
    created_by INTEGER NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users (id),
    FOREIGN KEY (created_by) REFERENCES users (id)
  );
  CREATE INDEX idx_auth_wechat_invitation_user ON auth_wechat_invitations (user_id);
  CREATE INDEX idx_auth_wechat_invitation_expiry ON auth_wechat_invitations (expires_at, used_at);`;
}

function sqliteAuthLoginRateLimits() {
  return `CREATE TABLE auth_login_rate_limits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    route_key VARCHAR(32) NOT NULL,
    subject_hash VARCHAR(64) NOT NULL,
    window_started_at DATETIME NOT NULL,
    attempt_count INT NOT NULL DEFAULT 0,
    blocked_until DATETIME NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (route_key, subject_hash)
  );
  CREATE INDEX idx_auth_rate_blocked ON auth_login_rate_limits (blocked_until);`;
}

function sqliteAuthSecurityEvents() {
  return `CREATE TABLE auth_security_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type VARCHAR(32) NOT NULL,
    outcome VARCHAR(16) NOT NULL,
    route_key VARCHAR(32) NOT NULL,
    subject_hash VARCHAR(64) NOT NULL,
    ip_hash VARCHAR(64) NOT NULL,
    user_id INTEGER NULL,
    city_id INTEGER NULL,
    reason_code VARCHAR(64) NOT NULL,
    request_id VARCHAR(64) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX idx_auth_event_created ON auth_security_events (created_at);
  CREATE INDEX idx_auth_event_subject ON auth_security_events (subject_hash, created_at);
  CREATE INDEX idx_auth_event_ip ON auth_security_events (ip_hash, created_at);`;
}

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function randomUuidSqlite() {
  const value = randomBytes(16).toString('hex');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-4${value.slice(13, 16)}-8${value.slice(17, 20)}-${value.slice(20, 32)}`;
}
function clean(value) { return String(value ?? '').replace(/[\r\n\t]+/g, ' ').slice(0, 1000); }
function quoteIdentifier(value) { if (!/^[A-Za-z0-9_]+$/.test(value)) fail('INVALID_IDENTIFIER'); return `"${value}"`; }
function quoteSqlLiteral(value) { return `'${String(value).replace(/'/g, "''")}'`; }
function normalizePrimaryContractNumber(value) {
  const first = String(value ?? '').split(/[\/／\r\n]+/).map((part) => part.trim()).find(Boolean) || '';
  return first.replace(/-\d{1,2}$/, '').trim();
}
function fail(message) { throw new Error(message); }
