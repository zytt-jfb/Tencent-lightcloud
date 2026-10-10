import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const root = mkdtempSync(path.join(tmpdir(), 'biz-contract-ledger-'));
const database = path.join(root, 'test.sqlite');
const requireFromApi = createRequire(path.join(repoRoot, 'apps', 'api', 'package.json'));
const Database = requireFromApi('better-sqlite3');
const env = { ...process.env, NODE_ENV: 'test', DB_TYPE: 'sqlite', DB_DATABASE: database, DB_SYNC: 'false', JWT_SECRET: 'contract-ledger-test-jwt-0123456789', AUTH_SECURITY_HMAC_KEY: 'contract-ledger-test-hmac-0123456789', JWT_ISSUER: 'biz-reporting-api', JWT_AUDIENCE: 'biz-reporting-clients', PORT: '0' };
const freePort = () => new Promise((resolve, reject) => { const server = createServer(); server.unref(); server.on('error', reject); server.listen(0, '127.0.0.1', () => { const address = server.address(); const port = typeof address === 'object' && address ? address.port : 0; server.close(() => resolve(port)); }); });
let processHandle;
try {
  execFileSync(process.execPath, ['scripts/db/migrate.mjs', 'up'], { cwd: repoRoot, env, stdio: 'ignore' });
  execFileSync(process.execPath, ['scripts/auth/biz-init-super-admin.mjs'], { cwd: repoRoot, env: { ...env, BIZ_SUPER_ADMIN_USERNAME: 'ledger_super', BIZ_SUPER_ADMIN_PASSWORD: 'Ledger-secret-1' }, stdio: 'ignore' });
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}/api`;
  processHandle = spawn(process.execPath, ['apps/api/dist/main.js'], { cwd: repoRoot, env: { ...env, PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe'] });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { try { const response = await fetch(`${baseUrl}/biz/auth/me`); if (response.status === 401 || response.status === 200) break; } catch {} await new Promise((resolve) => setTimeout(resolve, 200)); }
  const login = await fetch(`${baseUrl}/biz/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'ledger_super', password: 'Ledger-secret-1' }) });
  assert.equal(login.status, 201);
  const token = (await login.json()).accessToken;
  const form = new FormData();
  form.append('file', new Blob([readFileSync(String.raw`C:\Users\lhx\Desktop\工作资料\数据库\临时\5.8\外省(1).xlsx`)]), '外省(1).xlsx');
  const upload = await fetch(`${baseUrl}/biz/contracts/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  const uploadText = await upload.text();
  assert.equal(upload.status, 201, uploadText);
  const summary = JSON.parse(uploadText);
  assert.equal(summary.sheetCount, 3);
  assert.equal(summary.totalRows, 129);
  assert.ok(summary.importRecordId);
  const records = await fetch(`${baseUrl}/biz/contracts/import-records`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(records.status, 200);
  const recordItems = (await records.json()).items;
  assert.equal(recordItems.length, 1);
  const [provinceResponse, cityResponse] = await Promise.all([
    fetch(`${baseUrl}/biz/admin/provinces`, { headers: { Authorization: `Bearer ${token}` } }),
    fetch(`${baseUrl}/biz/admin/cities`, { headers: { Authorization: `Bearer ${token}` } }),
  ]);
  const provinceItems = (await provinceResponse.json()).items;
  const cityItems = (await cityResponse.json()).items;
  assert.ok(provinceItems.some((item) => item.name === '黑龙江省'), 'province auto configuration missing');
  assert.ok(cityItems.length > 16, 'city auto configuration missing');
  assert.ok(summary.created > 0, 'core-valid ledger rows should create active contracts');
  const db = new Database(database, { readonly: true });
  const activeContracts = db.prepare("SELECT COUNT(*) FROM biz_contracts WHERE source_import_record_id = ? AND status = 'active' AND amount_locked = 1").pluck().get(summary.importRecordId);
  assert.equal(activeContracts, summary.created, 'uploaded contracts should be active and locked');
  const invalidAllocationTotals = db.prepare(`SELECT c.id
    FROM biz_contracts c LEFT JOIN biz_contract_city_allocations a ON a.contract_id = c.id AND a.status = 'active'
    WHERE c.source_import_record_id = ? GROUP BY c.id
    HAVING COUNT(a.id) > 0 AND SUM(COALESCE(a.quota_fen, 0)) != c.tax_inclusive_amount_fen`).all(summary.importRecordId);
  assert.equal(invalidAllocationTotals.length, 0, 'average allocations must equal contract amount');
  db.close();
  const pendingResponse = await fetch(`${baseUrl}/biz/contracts/pending-maintenance`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(pendingResponse.status, 200);
  const pendingItems = (await pendingResponse.json()).items;
  assert.ok(pendingItems.length > 0, 'expected ledger maintenance rows');
  const provinceForMaintenance = provinceItems.find((item) => item.code === '230000') ?? provinceItems[0];
  const cityForMaintenance = cityItems.find((item) => item.provinceId === provinceForMaintenance.id) ?? cityItems[0];
  const maintain = await fetch(`${baseUrl}/biz/contracts/pending-maintenance/${pendingItems[0].sourceRowId}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ contractNo: `MAINTAIN-${Date.now()}`, contractName: '待维护合同测试', provinceId: provinceForMaintenance.id, cityIds: [cityForMaintenance.id], taxInclusiveAmountFen: 10000000, startDate: '2026-01-01', endDate: '2026-12-31', reason: '自动化维护验证' }),
  });
  const maintainText = await maintain.text();
  assert.equal(maintain.status, 201, maintainText);
  const maintained = JSON.parse(maintainText);
  assert.equal(maintained.status, 'active');
  const pendingAfterMaintenance = await fetch(`${baseUrl}/biz/contracts/pending-maintenance`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(pendingAfterMaintenance.status, 200);
  assert.equal((await pendingAfterMaintenance.json()).items.length, pendingItems.length - 1);
  const download = await fetch(`${baseUrl}/biz/contracts/import-records/${summary.importRecordId}/source-workbook`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(download.status, 200);
  assert.ok(Number(download.headers.get('content-length') ?? 1) > 0 || (await download.arrayBuffer()).byteLength > 0);
  const remove = await fetch(`${baseUrl}/biz/contracts/import-records/${summary.importRecordId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  assert.equal(remove.status, 400, 'active uploaded contracts must prevent deleting their upload record');
  const afterDelete = await fetch(`${baseUrl}/biz/contracts/import-records`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(afterDelete.status, 200);
  assert.equal((await afterDelete.json()).items.length, 1);
  console.log(`CONTRACT_LEDGER_IMPORT_OK sheets=${summary.sheetCount} rows=${summary.totalRows} created=${summary.created} review=${summary.reviewRows} provinces=${provinceItems.length} units=${cityItems.length} activeDeleteBlocked=true issues=${JSON.stringify(summary.issues?.slice(0, 3) ?? [])}`);
} finally {
  if (processHandle && !processHandle.killed) processHandle.kill('SIGTERM');
  try { rmSync(root, { recursive: true, force: true }); } catch { /* Windows may release child handles after process exit. */ }
}
