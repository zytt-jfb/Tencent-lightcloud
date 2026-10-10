import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const XLSX = require('xlsx');
const bcrypt = require('bcryptjs');

const [dbPath, referenceRoot, outputDir, apiBase = 'http://127.0.0.1:3010/api', storageRoot] = process.argv.slice(2);
if (!dbPath || !referenceRoot || !outputDir || !storageRoot) throw new Error('usage: node facts-v31.integration.mjs <db> <reference-root> <output-dir> <api> <storage-root>');

const evidence = [];
const record = (name, details) => { evidence.push({ name, status: 'pass', details }); console.log(`PASS ${name}: ${details}`); };
const assertEffective = (status) => assert.ok(
  ['current_effective', 'effective_with_warning'].includes(status),
  `expected an effective lifecycle status, received ${status}`,
);
const db = new Database(dbPath);
db.pragma('foreign_keys = OFF');
const password = 'FactsV31!2026';
const passwordHash = bcrypt.hashSync(password, 10);
const cityId = Number(db.prepare("select id from cities where name = '济宁'").pluck().get());
const otherCityId = Number(db.prepare("select id from cities where name = '淄博'").pluck().get());
assert.ok(cityId && otherCityId);

const dailyPath = path.join(referenceRoot, '成本', '2026年7月日常报销明细表-济宁.xlsx');
const mileagePath = path.join(referenceRoot, '成本', '6月里程油补申请-20260701095824.xlsx');
const orderPath = path.join(referenceRoot, '订单', '中屹电商第一季度订单明细.xlsx');
const orderWb = XLSX.readFile(orderPath);
const orderSheet = orderWb.Sheets['电商化订单列表'];
const orderRows = XLSX.utils.sheet_to_json(orderSheet, { header: 1, defval: null, raw: false });
const orderHeaders = orderRows[0];
const cityIndex = orderHeaders.indexOf('地市名称');
const contractIndex = orderHeaders.indexOf('合同编号');
const jiningOrderRows = orderRows.slice(1).filter((row) => String(row[cityIndex] || '').includes('济宁')).slice(0, 8);
const qingdaoOrderRows = orderRows.slice(1).filter((row) => String(row[cityIndex] || '').includes('青岛')).slice(0, 2);
assert.ok(jiningOrderRows.length >= 2 && qingdaoOrderRows.length >= 1);
const contractCodes = [...new Set(jiningOrderRows.map((row) => String(row[contractIndex]).trim()))];

const insertUser = db.prepare(`INSERT OR REPLACE INTO users (id, role, name, city_id, openid, username, password_hash, status, register_at, created_at, updated_at)
  VALUES (?, ?, ?, ?, NULL, ?, ?, 'enabled', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`);
insertUser.run(99001, 'city_user', '事实测试济宁', cityId, 'facts_jining', passwordHash);
insertUser.run(99002, 'city_user', '事实测试淄博', otherCityId, 'facts_zibo', passwordHash);
insertUser.run(99003, 'system_admin', '事实测试省级管理员', null, 'facts_admin', passwordHash);
const insertContract = db.prepare(`INSERT OR REPLACE INTO contracts (id, contract_code, contract_name, contract_amount, rate, accumulated_order_amount, accumulated_invoice_amount, is_deleted, created_by, updated_by, created_at, updated_at) VALUES (?, ?, ?, 1000000, 0.05, 0, 0, 0, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`);
const insertAllocation = db.prepare(`INSERT OR REPLACE INTO contract_city_allocations (id, contract_id, city_id, city_contract_amount, rate, accumulated_order_amount, accumulated_invoice_amount, created_at, updated_at) VALUES (?, ?, ?, 800000, 0.05, 0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`);
contractCodes.forEach((code, index) => { insertContract.run(99100 + index, code, `真实订单样例合同 ${index + 1}`); insertAllocation.run(99200 + index, 99100 + index, cityId); });
const primaryContract = contractCodes[0];
db.close();

fs.mkdirSync(outputDir, { recursive: true });
function writeRows(name, sheetName, rows) { const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), sheetName); const file = path.join(outputDir, name); XLSX.writeFile(wb, file); return file; }
const orderSubset = writeRows('真实订单-济宁子集.xlsx', '电商化订单列表', [orderHeaders, ...jiningOrderRows]);
const crossCityOrder = writeRows('真实订单-跨地市阻断.xlsx', '电商化订单列表', [orderHeaders, ...qingdaoOrderRows]);
const unallocatedRow = [...jiningOrderRows[0]]; unallocatedRow[contractIndex] = 'UNALLOCATED-CONTRACT';
const unallocatedOrder = writeRows('真实订单-未分配合同.xlsx', '电商化订单列表', [orderHeaders, unallocatedRow]);
const invalidRow = [...jiningOrderRows[0]]; invalidRow[orderHeaders.indexOf('含税总金额')] = '金额错误';
const invalidOrder = writeRows('真实订单-金额错误.xlsx', '电商化订单列表', [orderHeaders, invalidRow]);
const duplicateBusinessOrder = writeRows('真实订单-业务键冲突.xlsx', '重复订单行', [orderHeaders, jiningOrderRows[0]]);
const unparseableOrder = path.join(outputDir, '不可解析订单.xlsx'); fs.writeFileSync(unparseableOrder, Buffer.from('not-an-excel-file'));
const mileageWb = XLSX.readFile(mileagePath); const mileageSheet = mileageWb.Sheets[mileageWb.SheetNames[0]]; const mileageRows = XLSX.utils.sheet_to_json(mileageSheet, { header: 1, defval: null, raw: false });
const mileageCityIndex = mileageRows[0].indexOf('所属地市'); const jiningMileage = mileageRows.slice(1).filter((row) => String(row[mileageCityIndex] || '').includes('济宁')).slice(0, 5);
assert.ok(jiningMileage.length >= 1); const mileageSubset = writeRows('真实里程油补-济宁子集.xlsx', mileageWb.SheetNames[0], [mileageRows[0], ...jiningMileage]);

async function json(pathname, { token, method = 'GET', body, expected = 200 } = {}) {
  const response = await fetch(`${apiBase}${pathname}`, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => null); assert.equal(response.status, expected, `${pathname}: ${response.status} ${JSON.stringify(data)}`); return data;
}
async function upload(pathname, filePath, token, fields = {}) {
  const form = new FormData(); form.append('file', new File([fs.readFileSync(filePath)], path.basename(filePath), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  Object.entries(fields).forEach(([key, value]) => form.append(key, value));
  const response = await fetch(`${apiBase}${pathname}`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
  const data = await response.json(); assert.equal(response.status, 201, `${pathname}: ${response.status} ${JSON.stringify(data)}`); return data;
}
async function login(username) { return (await json('/auth/city/login', { method: 'POST', body: { username, password } })).token; }
const jiningToken = await login('facts_jining'); const ziboToken = await login('facts_zibo');
const adminToken = (await json('/auth/admin/login', { method: 'POST', body: { username: 'facts_admin', password } })).token;

const contracts = await json('/city/facts/contracts?year=2026&cityId=1', { token: jiningToken });
assert.ok(contractCodes.every((code) => contracts.some((item) => item.contractCode === code)));
record('本地合同范围', `济宁账号忽略 URL cityId，只返回 ${contracts.length} 个济宁已分配合同`);

const daily = await upload('/city/facts/costs/import', dailyPath, jiningToken, { templateType: 'daily_reimbursement', contractCode: primaryContract });
assertEffective(daily.status); assert.ok(daily.successRows > 0); record('日常报销导入', `${daily.successRows} 行，批次 #${daily.batchId}`);
const dailyLineage = await json(`/city/facts/import-batches/${daily.batchId}`, { token: jiningToken });
assert.equal(dailyLineage.sourceFileAvailable, true); assert.ok(dailyLineage.sourceFileStorageKey && dailyLineage.lineage.sourceRows.length === daily.successRows);
assert.ok(dailyLineage.lineage.costFacts.length === daily.successRows && dailyLineage.lineage.factVersions.length === daily.successRows && dailyLineage.lineage.operationLogIds.length >= 1);
const sourceResponse = await fetch(`${apiBase}/city/facts/import-batches/${daily.batchId}/source-file`, { headers: { Authorization: `Bearer ${jiningToken}` } });
assert.equal(sourceResponse.status, 200); const sourceBytes = Buffer.from(await sourceResponse.arrayBuffer());
assert.equal(createHash('sha256').update(sourceBytes).digest('hex'), dailyLineage.sourceFileSha256);
assert.ok(fs.existsSync(path.join(storageRoot, dailyLineage.sourceFileStorageKey)));
const crossCitySourceResponse = await fetch(`${apiBase}/city/facts/import-batches/${daily.batchId}/source-file`, { headers: { Authorization: `Bearer ${ziboToken}` } });
assert.equal(crossCitySourceResponse.status, 404);
record('原始文件与全链路回查', `批次 #${daily.batchId} 可回查文件、${dailyLineage.lineage.sourceRows.length} 个来源行、事实、版本和操作日志`);
record('跨地市原文件下载阻断', `淄博账号下载济宁批次 #${daily.batchId} 返回 404`);
const dailyAgain = await upload('/city/facts/costs/import', dailyPath, jiningToken, { templateType: 'daily_reimbursement', contractCode: primaryContract });
assert.equal(dailyAgain.idempotent, true); record('成本重复导入幂等', `重复文件仍返回批次 #${dailyAgain.batchId}，未重复累计`);
const mileage = await upload('/city/facts/costs/import', mileageSubset, jiningToken, { templateType: 'mileage_subsidy', contractCode: primaryContract });
assertEffective(mileage.status); record('里程油补导入', `${mileage.successRows} 行并保留 44 列原始载荷`);
const orders = await upload('/city/facts/orders/import', orderSubset, jiningToken);
assertEffective(orders.status); assert.equal(orders.successRows, jiningOrderRows.length); record('真实订单导入', `${orders.successRows} 个来源行`);
const ordersAgain = await upload('/city/facts/orders/import', orderSubset, jiningToken); assert.equal(ordersAgain.idempotent, true); record('订单重复导入幂等', `重复文件未重复累计`);

const summary = await json('/city/facts/summary?year=2026', { token: jiningToken }); assert.ok(summary.totals.actualCost > 0 && summary.totals.orderAmount !== 0);
record('事实聚合变化', `实际成本 ${summary.totals.actualCost}，订单 ${summary.totals.orderAmount}`);
const createdCost = await json('/city/facts/costs', { token: jiningToken, method: 'POST', body: { contractId: contracts[0].contractId, occurredOn: '2026-07-28', costCategoryCode: 'reimbursement', costSubtype: '在线验证', description: '隔离库验证成本', amount: 123.45, reason: '集成验证新增' }, expected: 201 });
const updatedCost = await json(`/city/facts/costs/${createdCost.id}`, { token: jiningToken, method: 'PATCH', body: { amount: 234.56, reason: '集成验证编辑', expectedVersionNo: createdCost.versionNo } }); assert.equal(updatedCost.amount, 234.56);
const refreshedCosts = await json('/city/facts/costs?year=2026&pageSize=100', { token: jiningToken }); assert.ok(refreshedCosts.items.some((item) => item.id === createdCost.id && item.amount === 234.56)); record('成本在线编辑持久化', `成本 #${createdCost.id} 刷新后金额 234.56`);
const reversedCost = await json(`/city/facts/costs/${createdCost.id}/reverse`, { token: jiningToken, method: 'POST', body: { reason: '集成验证冲销', expectedVersionNo: updatedCost.versionNo }, expected: 201 });
assert.equal(reversedCost.amount, -234.56); record('成本冲销', `成本 #${createdCost.id} 已生成冲销事实 #${reversedCost.id}`);
const createdOrder = await json('/city/facts/orders', { token: jiningToken, method: 'POST', body: { contractId: contracts[0].contractId, purchaseOrderNo: 'FACTS-MANUAL-REVERSAL', orderStatus: '取消', taxInclusiveAmount: -88.5, materialName: '合法负数冲销', materialCode: 'REV-001', orderedAt: '2026-07-28T08:00:00.000Z', reason: '集成验证负数订单' }, expected: 201 });
assert.equal(createdOrder.isReversal, true); record('订单负数冲销', `订单 #${createdOrder.id} 以合法冲销写入`);
const updatedOrder = await json(`/city/facts/orders/${createdOrder.id}`, { token: jiningToken, method: 'PATCH', body: { orderStatus: '已取消并冲销', reason: '集成验证编辑', expectedVersionNo: createdOrder.versionNo } });
assert.equal(updatedOrder.orderStatus, '已取消并冲销');
const refreshedOrders = await json('/city/facts/orders?year=2026&pageSize=100', { token: jiningToken }); assert.ok(refreshedOrders.items.some((item) => item.id === createdOrder.id && item.orderStatus === '已取消并冲销'));
record('订单在线编辑持久化', `订单 #${createdOrder.id} 刷新后状态仍为“已取消并冲销”`);
const reversedOrder = await json(`/city/facts/orders/${createdOrder.id}/reverse`, { token: jiningToken, method: 'POST', body: { reason: '集成验证冲销', expectedVersionNo: updatedOrder.versionNo }, expected: 201 });
assert.equal(reversedOrder.isReversal, true); record('订单冲销', `订单 #${createdOrder.id} 已生成抵消事实 #${reversedOrder.id}`);

const ziboView = await json('/city/facts/costs?cityId=' + cityId + '&pageSize=100', { token: ziboToken }); assert.ok(!ziboView.items.some((item) => item.cityId === cityId));
const ziboContracts = await json('/city/facts/contracts?cityId=' + cityId, { token: ziboToken }); assert.ok(ziboContracts.every((item) => item.cityId === otherCityId)); record('跨地市读取阻断', 'URL cityId 无法覆盖 JWT 绑定地市');
const adminSummary = await json(`/admin/facts/summary?cityId=${cityId}&year=2026`, { token: adminToken }); assert.equal(adminSummary.totals.orderAmount, (await json('/city/facts/summary?year=2026', { token: jiningToken })).totals.orderAmount); record('Admin 地市筛选', 'Admin 与地市端同口径汇总一致');
const provinceSummary = await json('/admin/facts/summary?year=2026', { token: adminToken });
assert.equal(provinceSummary.scope, 'province'); assert.ok(provinceSummary.cities.some((item) => item.cityId === cityId));
const selectionSummary = await json(`/admin/facts/summary?cityIds=${cityId},${otherCityId}&year=2026`, { token: adminToken });
assert.equal(selectionSummary.scope, 'selection');
assert.deepEqual(new Set(selectionSummary.cities.map((item) => item.cityId)), new Set([cityId, otherCityId]));
const selectionCosts = await json(`/admin/facts/costs?cityIds=${cityId},${otherCityId}&year=2026&pageSize=10000`, { token: adminToken });
assert.ok(selectionCosts.items.every((item) => item.cityId === cityId || item.cityId === otherCityId));
const selectionOrders = await json(`/admin/facts/orders?cityIds=${cityId},${otherCityId}&year=2026&pageSize=10000`, { token: adminToken });
assert.ok(selectionOrders.items.every((item) => item.cityId === cityId || item.cityId === otherCityId));
record('Admin 多地市筛选', `summary=${selectionSummary.cities.length} costs=${selectionCosts.total} orders=${selectionOrders.total}`);
assert.equal(provinceSummary.totals.orderAmount, provinceSummary.cities.reduce((sum, item) => sum + item.totals.orderAmount, 0));
record('Admin 全省汇总', `返回全省总计与 ${provinceSummary.cities.length} 个地市拆分`);

const checkDb = new Database(dbPath); const beforeFailures = Number(checkDb.prepare('select count(*) from order_facts').pluck().get()); checkDb.close();
for (const [name, file] of [['跨地市导入', crossCityOrder], ['未分配合同', unallocatedOrder], ['金额字段错误', invalidOrder]]) { const result = await upload('/city/facts/orders/import', file, jiningToken); assert.equal(result.status, 'validation_failed'); assert.ok(result.issues.length); record(name, `${result.issues.length} 个阻塞问题，批次 #${result.batchId}`); }
const keyConflict = await upload('/city/facts/orders/import', duplicateBusinessOrder, jiningToken); assert.equal(keyConflict.status, 'validation_failed'); assert.ok(keyConflict.issues.some((issue) => issue.field === '行级业务键')); record('跨文件业务键冲突', `批次 #${keyConflict.batchId} 未覆盖既有订单行`);
const unparseable = await upload('/city/facts/orders/import', unparseableOrder, jiningToken); assert.equal(unparseable.status, 'validation_failed');
const failedLineage = await json(`/city/facts/import-batches/${unparseable.batchId}`, { token: jiningToken });
assert.equal(failedLineage.sourceFileAvailable, true); assert.equal(failedLineage.lineage.sourceRows.length, 0); assert.ok(failedLineage.lineage.operationLogIds.length >= 1);
const failedSourceResponse = await fetch(`${apiBase}/city/facts/import-batches/${unparseable.batchId}/source-file`, { headers: { Authorization: `Bearer ${jiningToken}` } });
assert.equal(failedSourceResponse.status, 200); assert.equal(Buffer.from(await failedSourceResponse.arrayBuffer()).toString(), 'not-an-excel-file');
record('解析失败原文件回查', `批次 #${unparseable.batchId} 保留不可解析文件、错误与失败操作日志`);
fs.unlinkSync(path.join(storageRoot, failedLineage.sourceFileStorageKey));
const missingSourceResponse = await fetch(`${apiBase}/city/facts/import-batches/${unparseable.batchId}/source-file`, { headers: { Authorization: `Bearer ${jiningToken}` } });
assert.equal(missingSourceResponse.status, 404);
record('原文件缺失拒绝审计', `批次 #${unparseable.batchId} 的受控文件缺失后返回 404`);
const finalDb = new Database(dbPath); assert.equal(Number(finalDb.prepare('select count(*) from order_facts').pluck().get()), beforeFailures);
assert.ok(Number(finalDb.prepare("select count(*) from operation_logs where action_type in ('cost_create','cost_update','order_create','cost_import','order_import')").pluck().get()) >= 5);
const downloadLogs = finalDb.prepare("select operator_user_id, operator_city_id, target_id, result_status, after_data_json from operation_logs where action_type = 'fact_source_file_download'").all()
  .map((row) => ({ ...row, details: typeof row.after_data_json === 'string' ? JSON.parse(row.after_data_json) : row.after_data_json }));
assert.ok(downloadLogs.some((log) => log.target_id === String(daily.batchId) && log.result_status === 'success' && log.details.fileSha256 === dailyLineage.sourceFileSha256 && log.details.downloadResult === 'success'));
assert.ok(downloadLogs.some((log) => Number(log.operator_user_id) === 99002 && Number(log.operator_city_id) === otherCityId && log.target_id === String(daily.batchId) && log.result_status === 'denied' && log.details.downloadResult === 'scope_denied'));
assert.ok(downloadLogs.some((log) => log.target_id === String(unparseable.batchId) && log.result_status === 'failed' && log.details.downloadResult === 'source_file_missing'));
assert.ok(Number(finalDb.prepare('select count(*) from fact_versions').pluck().get()) > 0);
assert.ok(Number(finalDb.prepare('select count(*) from fact_source_rows').pluck().get()) > 0);
assert.equal(Number(finalDb.prepare('select count(*) from fact_import_batches where source_file_storage_key is null or source_file_size is null or source_file_stored_at is null').pluck().get()), 0);
record('失败批次原子性', '五个失败批次前后订单事实行数不变，来源行或文件级错误证据保留');
record('原文件下载审计', '成功下载、跨地市拒绝和文件缺失均记录操作者、地市、批次、SHA-256、结果与时间');
record('审计与血缘', 'operation_logs、fact_versions、fact_source_rows 与全部批次原文件元数据均有记录');
finalDb.close();

await json('/admin/contracts?page=1&pageSize=1', { token: adminToken });
await json('/admin/dashboard?year=2026&month=7', { token: adminToken });
record('现有 Admin 回归烟测', '合同管理与 Dashboard API 返回 200');
fs.writeFileSync(path.join(outputDir, 'facts-v31-evidence.json'), JSON.stringify({ generatedAt: new Date().toISOString(), database: path.basename(dbPath), referenceFiles: [dailyPath, mileagePath, orderPath], evidence }, null, 2));
