import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const XLSX = require('xlsx');
const bcrypt = require('bcryptjs');

const [dbPath, fixtureDir, apiBase, storageRoot] = process.argv.slice(2);
if (!dbPath || !fixtureDir || !apiBase || !storageRoot) throw new Error('missing V3 lifecycle test arguments');
const db = new Database(dbPath);
const cityId = Number(db.prepare("SELECT id FROM cities WHERE name = '济宁'").pluck().get());
assert.ok(cityId);
const password = 'V3Lifecycle!2026';
const passwordHash = bcrypt.hashSync(password, 10);
db.prepare(`INSERT INTO users (id, role, name, city_id, username, password_hash, status, auth_version, must_change_password, register_at, created_at, updated_at)
  VALUES (98001, 'city_user', 'V3生命周期测试', ?, 'v3_lifecycle_city', ?, 'enabled', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(cityId, passwordHash);
db.prepare(`INSERT INTO contracts (id, contract_code, contract_name, contract_amount, rate, accumulated_order_amount, accumulated_invoice_amount, is_deleted, created_by, updated_by, created_at, updated_at)
  VALUES (98101, 'V3-LIFECYCLE-CONTRACT', 'V3生命周期隔离合同', 100000, 0.05, 0, 0, 0, 98001, 98001, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run();
db.prepare(`INSERT INTO contract_city_allocations (id, contract_id, city_id, city_contract_amount, rate, accumulated_order_amount, accumulated_invoice_amount, created_at, updated_at)
  VALUES (98201, 98101, ?, 100000, 0.05, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(cityId);
db.close();

fs.mkdirSync(fixtureDir, { recursive: true });
function workbook(name, rows) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), '数据');
  const file = path.join(fixtureDir, name);
  XLSX.writeFile(wb, file);
  return file;
}
const warningFile = workbook('warning-effective.xlsx', [
  ['报销项目', '日期', '事由', '金额'],
  ['办公报销', '2026-07-30', '', '100.50'],
]);
const invalidFile = workbook('blocking-invalid.xlsx', [
  ['成本类别', '日期', '事由', '金额', '合同编号'],
  ['办公报销', '2026-07-30', '无效金额不能写入', 'invalid', 'V3-LIFECYCLE-CONTRACT'],
]);

async function call(pathname, { method = 'GET', token, body, expected = 200 } = {}) {
  const response = await fetch(`${apiBase}${pathname}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  assert.equal(response.status, expected, `${pathname}: ${response.status} ${JSON.stringify(data)}`);
  return data;
}
async function upload(file, token, fields) {
  const form = new FormData();
  form.append('file', new File([fs.readFileSync(file)], path.basename(file), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  const response = await fetch(`${apiBase}/city/facts/costs/import`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  const data = await response.json();
  assert.equal(response.status, 201, JSON.stringify(data));
  return data;
}

const token = (await call('/auth/city/login', { method: 'POST', body: { username: 'v3_lifecycle_city', password } })).token;
const warning = await upload(warningFile, token, { templateType: 'daily_reimbursement', contractCode: 'V3-LIFECYCLE-CONTRACT' });
assert.equal(warning.status, 'effective_with_warning');
assert.equal(warning.warningCount, 1);
assert.equal(warning.blockingErrorCount, 0);
assert.equal(warning.successRows, 1);
assert.equal(warning.issues[0].severity, 'warning');

let check = new Database(dbPath, { readonly: true });
const warningBatch = check.prepare('SELECT lifecycle_status, warning_count, blocking_error_count, effective_at, source_file_storage_key FROM fact_import_batches WHERE id = ?').get(warning.batchId);
assert.equal(warningBatch.lifecycle_status, 'effective_with_warning');
assert.equal(warningBatch.warning_count, 1);
assert.ok(warningBatch.effective_at);
assert.ok(fs.existsSync(path.join(storageRoot, warningBatch.source_file_storage_key)));
const countBeforeFailure = Number(check.prepare('SELECT COUNT(*) FROM cost_facts').pluck().get());
check.close();

const invalid = await upload(invalidFile, token, { templateType: 'standard_cost' });
assert.equal(invalid.status, 'validation_failed');
assert.ok(invalid.blockingErrorCount > 0);
assert.ok(invalid.issues.every((issue) => issue.severity === 'blocking'));
check = new Database(dbPath, { readonly: true });
assert.equal(Number(check.prepare('SELECT COUNT(*) FROM cost_facts').pluck().get()), countBeforeFailure);
assert.equal(check.prepare('SELECT lifecycle_status, effective_at FROM fact_import_batches WHERE id = ?').get(invalid.batchId).lifecycle_status, 'validation_failed');
check.close();

const created = await call('/city/facts/costs', {
  method: 'POST', token, expected: 201,
  body: { contractId: 98101, occurredOn: '2026-07-30', costCategoryCode: 'reimbursement', description: 'V3手工事实', amount: 12.34, reason: '建立并发测试基线' },
});
assert.equal(created.versionNo, 1);
const updated = await call(`/city/facts/costs/${created.id}`, {
  method: 'PATCH', token,
  body: { amount: 56.78, reason: '业务复核后修正金额', expectedVersionNo: 1 },
});
assert.equal(updated.versionNo, 2);
assert.equal(updated.amount, 56.78);
const conflict = await call(`/city/facts/costs/${created.id}`, {
  method: 'PATCH', token, expected: 409,
  body: { amount: 99.99, reason: '使用过期版本尝试覆盖', expectedVersionNo: 1 },
});
assert.equal(conflict.code, 'FACT_VERSION_CONFLICT');
assert.equal(conflict.current.versionNo, 2);
const missingReason = await call(`/city/facts/costs/${created.id}`, {
  method: 'PATCH', token, expected: 400,
  body: { amount: 60, reason: '', expectedVersionNo: 2 },
});
assert.ok(missingReason.message);

const versions = await call(`/city/facts/versions?factKind=cost&pageSize=100`, { token });
const chain = versions.items.filter((item) => item.factId === created.id).sort((left, right) => left.versionNo - right.versionNo);
assert.equal(chain.length, 2);
assert.equal(chain[0].lifecycleStatus, 'replaced');
assert.equal(chain[1].lifecycleStatus, 'current_effective');
assert.equal(chain[0].supersededByVersionId, chain[1].id);
assert.equal(chain[1].supersedesVersionId, chain[0].id);
assert.ok(chain[1].changedFields.includes('amount'));
assert.equal(chain[1].reason, '业务复核后修正金额');
const versionDetail = await call(`/city/facts/versions/${chain[1].id}`, { token });
assert.equal(versionDetail.beforeData.amount, 12.34);
assert.equal(versionDetail.afterData.amount, 56.78);

check = new Database(dbPath, { readonly: true });
const currentVersions = Number(check.prepare("SELECT COUNT(*) FROM fact_versions WHERE lifecycle_status IN ('current_effective','effective_with_warning')").pluck().get());
const replacedVersions = Number(check.prepare("SELECT COUNT(*) FROM fact_versions WHERE lifecycle_status = 'replaced'").pluck().get());
const auditCount = Number(check.prepare("SELECT COUNT(*) FROM operation_logs WHERE action_type IN ('cost_import','cost_create','cost_update')").pluck().get());
assert.ok(currentVersions >= 2);
assert.ok(replacedVersions >= 1);
assert.ok(auditCount >= 4);
check.close();
console.log(`V3_FACT_LIFECYCLE_OK warning_batch=${warning.batchId} failed_batch=${invalid.batchId} fact=${created.id} versions=${chain.length}`);
