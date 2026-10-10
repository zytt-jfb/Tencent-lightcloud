import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const apiRoot = path.join(repoRoot, 'apps', 'api');
const requireFromApi = createRequire(path.join(apiRoot, 'package.json'));
const Database = requireFromApi('better-sqlite3');
const bcrypt = requireFromApi('bcryptjs');

const database = process.env.BIZ_DEMO_DB_DATABASE || process.env.DB_DATABASE;
const password = process.env.BIZ_DEMO_PASSWORD || '';
const checkOnly = process.argv.includes('--check');
const targetPath = database ? path.resolve(repoRoot, database) : '';

if (String(process.env.NODE_ENV).toLowerCase() === 'production') fail('DEMO_SEED_PRODUCTION_FORBIDDEN');
if (!database) fail('BIZ_DEMO_DB_DATABASE/DB_DATABASE required');
if (!targetPath.toLowerCase().includes(`${path.sep}.artifacts${path.sep}manual-test${path.sep}`.toLowerCase())) {
  fail('DEMO_DATABASE_MUST_BE_MANUAL_TEST_ARTIFACT');
}
if (!fs.existsSync(targetPath)) fail(`DEMO_DATABASE_NOT_FOUND path=${targetPath}`);
if (!checkOnly && password.length < 8) fail('BIZ_DEMO_PASSWORD(>=8) required');

const ids = {
  admin: '00000000-0000-4000-8000-000000000201',
  contractManager: '00000000-0000-4000-8000-000000000202',
  cityUser: '00000000-0000-4000-8000-000000000203',
  activeContract: '00000000-0000-4000-8000-000000000301',
  draftContract: '00000000-0000-4000-8000-000000000302',
  activeAllocation: '00000000-0000-4000-8000-000000000311',
  draftAllocation: '00000000-0000-4000-8000-000000000312',
  activeFeeRate: '00000000-0000-4000-8000-000000000321',
  draftFeeRate: '00000000-0000-4000-8000-000000000322',
  orderBatch: '00000000-0000-4000-8000-000000000401',
  orderRow1: '00000000-0000-4000-8000-000000000411',
  orderRow2: '00000000-0000-4000-8000-000000000412',
  offlinePending: '00000000-0000-4000-8000-000000000501',
  offlineApproved: '00000000-0000-4000-8000-000000000502',
  costPending: '00000000-0000-4000-8000-000000000601',
  costApproved: '00000000-0000-4000-8000-000000000602',
};

const cityId = '00000000-0000-4000-8000-000000000101';
const provinceId = '00000000-0000-4000-8000-000000000030';
const superAdmin = findSuperAdmin();
const db = new Database(targetPath);
db.pragma('foreign_keys = ON');

try {
  const counts = getCounts();
  if (checkOnly) {
    console.log(`BIZ_DEMO_READINESS users=${counts.users} contracts=${counts.contracts} orders=${counts.orders} offline=${counts.offline} costs=${counts.costs}`);
    process.exit(0);
  }

  const passwordHash = bcrypt.hashSync(password, 10);
  db.transaction(() => {
    ensureUser('demo_admin', 'admin', 'Demo Province Admin', null, passwordHash);
    ensureUser('demo_contract', 'contract_manager', 'Demo Contract Manager', null, passwordHash);
    ensureUser('demo_city', 'city_user', 'Demo Jinan User', cityId, passwordHash);

    insertIfMissing('biz_contracts', 'id', ids.activeContract, {
      id: ids.activeContract, contract_no: 'DEMO-2026-001', contract_name: 'Demo Jinan Maintenance Contract',
      tax_inclusive_amount_fen: 1200000, tax_exclusive_amount_fen: 1132075, province_id: provinceId,
      start_date: '2026-01-01', end_date: '2026-12-31', status: 'active', tags: '[]', amount_locked: 1,
      version_no: 2, created_by: superAdmin.id, updated_by: superAdmin.id,
    });
    insertIfMissing('biz_contracts', 'id', ids.draftContract, {
      id: ids.draftContract, contract_no: 'DEMO-2026-002', contract_name: 'Demo Qingdao Expansion Contract',
      tax_inclusive_amount_fen: 860000, tax_exclusive_amount_fen: 811321, province_id: provinceId,
      start_date: '2026-03-01', end_date: '2026-12-31', status: 'draft', tags: '[]', amount_locked: 0,
      version_no: 1, created_by: superAdmin.id, updated_by: superAdmin.id,
    });
    insertIfMissing('biz_contract_city_allocations', 'id', ids.activeAllocation, {
      id: ids.activeAllocation, contract_id: ids.activeContract, city_id: cityId,
      quota_fen: 1200000, status: 'active', version_no: 1,
    });
    insertIfMissing('biz_contract_city_allocations', 'id', ids.draftAllocation, {
      id: ids.draftAllocation, contract_id: ids.draftContract, city_id: '00000000-0000-4000-8000-000000000102',
      quota_fen: 860000, status: 'active', version_no: 1,
    });
    insertIfMissing('biz_contract_fee_rates', 'id', ids.activeFeeRate, {
      id: ids.activeFeeRate, contract_id: ids.activeContract, city_id: cityId,
      effective_month: '2026-01', rate_bp: 1000, change_reason: 'Demo seed rate',
    });
    insertIfMissing('biz_contract_fee_rates', 'id', ids.draftFeeRate, {
      id: ids.draftFeeRate, contract_id: ids.draftContract, city_id: '00000000-0000-4000-8000-000000000102',
      effective_month: '2026-03', rate_bp: 1200, change_reason: 'Demo seed rate',
    });

    const fileHash = createHash('sha256').update('biz-demo-orders-2026-08').digest('hex');
    insertIfMissing('biz_order_import_batches', 'id', ids.orderBatch, {
      id: ids.orderBatch, filename: 'demo-orders-2026-08.xlsx', file_hash: fileHash,
      max_order_time: '2026-08-10 10:00:00', idempotency_key: 'demo-orders-2026-08', status: 'imported',
      total_rows: 2, imported_rows: 2, uploaded_by: ids.admin,
      data_scope_json: JSON.stringify({ roleCode: 'admin', scopeType: 'province', provinceIds: [], cityId: null }),
    });
    insertIfMissing('biz_order_rows', 'id', ids.orderRow1, orderRow(ids.orderRow1, 2, 'PO-DEMO-001', '2026-08-08 09:30:00', 350000));
    insertIfMissing('biz_order_rows', 'id', ids.orderRow2, orderRow(ids.orderRow2, 3, 'PO-DEMO-002', '2026-08-12 14:15:00', 180000));

    insertIfMissing('biz_offline_completions', 'id', ids.offlinePending, {
      id: ids.offlinePending, contract_id: ids.activeContract, city_id: cityId, business_month: '2026-08',
      amount_fen: 150000, summary: 'Demo pending offline completion', status: 'pending',
      submitted_by: ids.cityUser, submitted_at: '2026-08-15 10:00:00', version_no: 1,
      fee_rate_snapshot_bp: 1000, gross_profit_fen: 15000,
    });
    insertIfMissing('biz_offline_completions', 'id', ids.offlineApproved, {
      id: ids.offlineApproved, contract_id: ids.activeContract, city_id: cityId, business_month: '2026-07',
      amount_fen: 180000, summary: 'Demo approved offline completion', status: 'approved',
      submitted_by: ids.cityUser, submitted_at: '2026-07-15 10:00:00', reviewer_id: superAdmin.id,
      reviewed_at: '2026-07-16 10:00:00', version_no: 1, fee_rate_snapshot_bp: 1000, gross_profit_fen: 18000,
    });
    insertIfMissing('biz_cost_entries', 'id', ids.costPending, {
      id: ids.costPending, city_id: cityId, business_month: '2026-08', category_code: 'labor',
      amount_fen: 60000, description: 'Demo pending labor cost', status: 'pending',
      submitted_by: ids.cityUser, submitted_at: '2026-08-16 11:00:00', version_no: 1,
    });
    insertIfMissing('biz_cost_entries', 'id', ids.costApproved, {
      id: ids.costApproved, city_id: cityId, business_month: '2026-07', category_code: 'rent',
      amount_fen: 80000, description: 'Demo approved rent cost', status: 'approved',
      submitted_by: ids.cityUser, submitted_at: '2026-07-16 11:00:00', reviewer_id: superAdmin.id,
      reviewed_at: '2026-07-17 11:00:00', version_no: 1,
    });
  })();

  console.log('BIZ_DEMO_SEED_OK accounts=3 contracts=2 orders=2 offline=2 costs=2');
} finally {
  db.close();
}

function findSuperAdmin() {
  const probe = new Database(targetPath, { readonly: true });
  const user = probe.prepare("SELECT id FROM biz_users WHERE role_code = 'super_admin' ORDER BY created_at LIMIT 1").get();
  probe.close();
  if (!user?.id) fail('SUPER_ADMIN_REQUIRED');
  return user;
}

function ensureUser(username, roleCode, name, boundCityId, passwordHash) {
  const existing = db.prepare('SELECT id, role_code, city_id FROM biz_users WHERE username = ?').get(username);
  if (existing) {
    if (existing.role_code !== roleCode || (existing.city_id ?? null) !== (boundCityId ?? null)) fail(`DEMO_USER_CONFLICT username=${username}`);
    db.prepare('UPDATE biz_users SET password_hash = ?, name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(
      passwordHash, name, existing.id,
    );
    return existing;
  }
  const id = username === 'demo_admin' ? ids.admin : username === 'demo_contract' ? ids.contractManager : ids.cityUser;
  db.prepare(`INSERT INTO biz_users
    (id, username, password_hash, role_code, name, city_id, status, auth_version, sensitive_order_scope, must_change_password, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'enabled', 1, 'masked', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(
    id, username, passwordHash, roleCode, name, boundCityId ?? null,
  );
  return { id };
}

function insertIfMissing(table, key, value, row) {
  if (db.prepare(`SELECT 1 FROM ${table} WHERE ${key} = ?`).get(value)) return;
  const columns = Object.keys(row);
  const placeholders = columns.map(() => '?').join(', ');
  db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`).run(...columns.map((column) => row[column]));
}

function orderRow(id, sourceRowNo, orderNo, orderTime, amountFen) {
  return {
    id, batch_id: ids.orderBatch, source_row_no: sourceRowNo,
    col_01: '山东省', col_02: '济南市', col_03: orderNo, col_04: 'Demo Supplier', col_05: '已完成',
    col_06: String(amountFen / 100), col_07: 'Demo maintenance material', col_09: 'DEMO-2026-001',
    col_23: orderTime, province_id: provinceId, city_id: cityId, contract_id: ids.activeContract,
    order_time_std: orderTime, business_month: '2026-08', completion_amount_fen: amountFen,
    fee_rate_snapshot_bp: 1000, gross_profit_fen: Math.round(amountFen / 10),
    city_overrun_flag: 0, contract_overrun_flag: 0, is_void: 0,
  };
}

function getCounts() {
  const count = (table, where = '') => Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table} ${where}`).get().count);
  return {
    users: count('biz_users', "WHERE username IN ('demo_admin', 'demo_contract', 'demo_city')"),
    contracts: count('biz_contracts', "WHERE id IN ('00000000-0000-4000-8000-000000000301', '00000000-0000-4000-8000-000000000302')"),
    orders: count('biz_order_rows', "WHERE batch_id = '00000000-0000-4000-8000-000000000401'"),
    offline: count('biz_offline_completions', "WHERE id IN ('00000000-0000-4000-8000-000000000501', '00000000-0000-4000-8000-000000000502')"),
    costs: count('biz_cost_entries', "WHERE id IN ('00000000-0000-4000-8000-000000000601', '00000000-0000-4000-8000-000000000602')"),
  };
}

function fail(message) {
  console.error(`[biz-seed-demo-data] ${message}`);
  process.exit(2);
}
