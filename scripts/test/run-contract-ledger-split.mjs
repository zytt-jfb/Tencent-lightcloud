import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workbookPath = String.raw`C:\Users\lhx\Desktop\测试(2).xlsx`;
const root = mkdtempSync(path.join(tmpdir(), 'biz-contract-ledger-split-'));
const database = path.join(root, 'test.sqlite');
const requireFromApi = createRequire(path.join(repoRoot, 'apps', 'api', 'package.json'));
const XLSX = requireFromApi('xlsx');
const Database = requireFromApi('better-sqlite3');
const env = { ...process.env, NODE_ENV: 'test', DB_TYPE: 'sqlite', DB_DATABASE: database, DB_SYNC: 'false', JWT_SECRET: 'contract-ledger-split-test-jwt-0123456789', AUTH_SECURITY_HMAC_KEY: 'contract-ledger-split-test-hmac-0123456789', JWT_ISSUER: 'biz-reporting-api', JWT_AUDIENCE: 'biz-reporting-clients' };
const freePort = () => new Promise((resolve, reject) => { const server = createServer(); server.unref(); server.on('error', reject); server.listen(0, '127.0.0.1', () => { const address = server.address(); const port = typeof address === 'object' && address ? address.port : 0; server.close(() => resolve(port)); }); });
const postFile = async (baseUrl, token, bytes, filename) => { const form = new FormData(); form.append('file', new Blob([bytes]), filename); return fetch(`${baseUrl}/biz/contracts/upload`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form }); };
let processHandle;
try {
  assert.equal(readFileSync(workbookPath).length > 0, true, '测试文件不存在或为空');
  execFileSync(process.execPath, ['scripts/db/migrate.mjs', 'up'], { cwd: repoRoot, env, stdio: 'ignore' });
  execFileSync(process.execPath, ['scripts/auth/biz-init-super-admin.mjs'], { cwd: repoRoot, env: { ...env, BIZ_SUPER_ADMIN_USERNAME: 'split_super', BIZ_SUPER_ADMIN_PASSWORD: 'Split-secret-1' }, stdio: 'ignore' });
  // 预置 5 个自治区标准省份，模拟生产“已存在省份”路径（验证已存在省份也能通过短称别名映射，且不重复创建）
  const seedDb = new Database(database);
  seedDb.exec(`INSERT OR IGNORE INTO biz_provinces (id, code, name, status) VALUES
    ('seed-prov-150000', '150000', '内蒙古自治区', 'active'),
    ('seed-prov-450000', '450000', '广西壮族自治区', 'active'),
    ('seed-prov-540000', '540000', '西藏自治区', 'active'),
    ('seed-prov-640000', '640000', '宁夏回族自治区', 'active'),
    ('seed-prov-650000', '650000', '新疆维吾尔自治区', 'active')`);
  seedDb.close();
  const port = await freePort(); const baseUrl = `http://127.0.0.1:${port}/api`;
  processHandle = spawn(process.execPath, ['apps/api/dist/main.js'], { cwd: repoRoot, env: { ...env, PORT: String(port) }, stdio: ['ignore', 'ignore', 'pipe'] });
  const deadline = Date.now() + 30000; while (Date.now() < deadline) { try { const response = await fetch(`${baseUrl}/health/live`); if (response.status === 200) break; } catch { /* wait */ } await new Promise((resolve) => setTimeout(resolve, 200)); }
  const login = await fetch(`${baseUrl}/biz/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'split_super', password: 'Split-secret-1' }) });
  assert.equal(login.status, 201); const token = (await login.json()).accessToken; const bytes = readFileSync(workbookPath);
  const upload = await postFile(baseUrl, token, bytes, '测试(2).xlsx'); const uploadText = await upload.text(); assert.equal(upload.status, 201, uploadText); const summary = JSON.parse(uploadText);
  assert.equal(summary.sheetCount, 3); assert.equal(summary.totalRows, 257); assert.ok(summary.importRecordId); assert.ok(summary.created > 0); assert.ok(summary.allocations > 0); assert.ok(summary.reviewRows > 0);
  const db = new Database(database, { readonly: true });
  const splitRows = db.prepare("SELECT contract_no, COUNT(*) AS row_count FROM biz_contract_source_rows r JOIN biz_contracts c ON c.id = r.contract_id WHERE r.import_record_id = ? GROUP BY contract_no HAVING COUNT(*) > 1 LIMIT 1").get(summary.importRecordId);
  assert.ok(splitRows, '应存在多地市拆行且统一关联一个合同');
  const splitContract = db.prepare('SELECT c.id, c.tax_inclusive_amount_fen AS amount FROM biz_contracts c WHERE c.source_import_record_id = ? AND c.contract_no = ?').get(summary.importRecordId, splitRows.contract_no);
  const splitAllocations = db.prepare("SELECT COUNT(*) AS allocations, COALESCE(SUM(quota_fen), 0) AS allocated FROM biz_contract_city_allocations WHERE contract_id = ? AND status = 'active'").get(splitContract.id);
  assert.equal(Number(splitAllocations.allocated), Number(splitContract.amount)); assert.ok(Number(splitAllocations.allocations) >= 2);
  const reviewReasons = db.prepare("SELECT normalization_message AS message FROM biz_contract_source_rows WHERE import_record_id = ? AND normalization_status = 'needs_review'").all(summary.importRecordId).map((row) => String(row.message ?? ''));
  assert.ok(reviewReasons.some((message) => message.includes('合同编号无法处理') || message.includes('合同编号为空'))); assert.ok(reviewReasons.some((message) => message.includes('金额')));
  db.close();
  // 省份/地市映射与原始行完整性断言（核心修复验证）
  const verifyDb = new Database(database, { readonly: true });
  const nmProvinces = verifyDb.prepare("SELECT id, code, name FROM biz_provinces WHERE code = '150000'").all();
  assert.equal(nmProvinces.length, 1, '内蒙古自治区(150000) 应恰好存在一条，不应因短称别名重复创建');
  assert.equal(nmProvinces[0].name, '内蒙古自治区', '省份名称必须为标准名，短称不应覆盖既有名称');
  const nmProvinceId = nmProvinces[0].id;
  const nmCityNames = verifyDb.prepare("SELECT name FROM biz_cities WHERE province_id = ?").all(nmProvinceId).map((row) => row.name);
  for (const expected of ['兴安盟', '呼伦贝尔市', '赤峰市', '通辽市']) {
    assert.ok(nmCityNames.includes(expected), `内蒙古下应存在地市 ${expected}`);
    assert.equal(nmCityNames.filter((name) => name === expected).length, 1, `地市 ${expected} 不应重复创建`);
  }
  assert.ok(!nmCityNames.includes('兴安盟市'), '不应生成错误的 兴安盟市（盟后缀不可追加“市”）');
  const dupCities = verifyDb.prepare("SELECT name, COUNT(*) AS c FROM biz_cities WHERE province_id = ? GROUP BY name HAVING COUNT(*) > 1").all(nmProvinceId);
  assert.equal(dupCities.length, 0, '同一省份下地市名称应唯一');
  const cellCheck = verifyDb.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN cells_json IS NULL OR source_row_no <= 0 THEN 1 ELSE 0 END) AS bad FROM biz_contract_source_rows WHERE import_record_id = ?").get(summary.importRecordId);
  assert.equal(Number(cellCheck.bad), 0, '原始行 cells_json 与行号(source_row_no)必须完整保留');
  verifyDb.close();
  const duplicate = await postFile(baseUrl, token, bytes, '测试(2).xlsx'); const duplicateText = await duplicate.text(); assert.ok([400, 409].includes(duplicate.status)); assert.match(duplicateText, /文件已上传过/);
  const existingBook = XLSX.read(bytes, { type: 'buffer' }); const existingSheet = existingBook.Sheets[existingBook.SheetNames[0]]; const existingRows = XLSX.utils.sheet_to_json(existingSheet, { header: 1, raw: true, defval: null }); const existingHeader = (existingRows[0] ?? []).map((value) => String(value ?? '').replace(/\s/g, '')); const contractColumn = existingHeader.findIndex((value) => value === '甲方合同编号' || value === '合同编号'); assert.ok(contractColumn >= 0); existingRows[1][contractColumn] = splitRows.contract_no; existingBook.Sheets[existingBook.SheetNames[0]] = XLSX.utils.aoa_to_sheet(existingRows); const existingFile = Buffer.from(XLSX.write(existingBook, { type: 'buffer', bookType: 'xlsx' })); const existing = await postFile(baseUrl, token, existingFile, '测试(2)-已存在合同.xlsx'); const existingText = await existing.text(); assert.equal(existing.status, 201, existingText); const existingSummary = JSON.parse(existingText); assert.equal(existingSummary.created >= 0, true); assert.ok(existingSummary.reviewRows > 0); assert.ok(existingSummary.issues.some((issue) => String(issue).includes('合同编号已存在')), JSON.stringify(existingSummary));
  const raceBook = XLSX.read(bytes, { type: 'buffer' }); raceBook.Sheets.Sheet3 = XLSX.utils.aoa_to_sheet([['race-marker'], ['same-upload-race']]); const raceFile = Buffer.from(XLSX.write(raceBook, { type: 'buffer', bookType: 'xlsx' })); const raceResponses = await Promise.all([postFile(baseUrl, token, raceFile, '测试(2)-并发.xlsx'), postFile(baseUrl, token, raceFile, '测试(2)-并发.xlsx')]); const raceResults = await Promise.all(raceResponses.map(async (response) => ({ status: response.status, text: await response.text() }))); assert.equal(raceResults.filter((result) => result.status === 201).length, 1, JSON.stringify(raceResults)); assert.ok(raceResults.some((result) => [400, 409].includes(result.status) && /文件已上传过/.test(result.text)), JSON.stringify(raceResults)); assert.ok(raceResults.every((result) => !/QueryFailedError|Internal server error/i.test(result.text)), JSON.stringify(raceResults));
  console.log(`CONTRACT_LEDGER_SPLIT_OK sheets=${summary.sheetCount} rows=${summary.totalRows} created=${summary.created} allocations=${summary.allocations} review=${summary.reviewRows} splitContract=${splitRows.contract_no}`);
} finally {
  if (processHandle && !processHandle.killed) processHandle.kill('SIGTERM');
  try { rmSync(root, { recursive: true, force: true }); } catch { /* Windows may release child handles after exit. */ }
}
