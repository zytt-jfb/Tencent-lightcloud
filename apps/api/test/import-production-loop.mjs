import Database from 'better-sqlite3';
import * as XLSX from 'xlsx';

const BASE = process.env.BASE || 'http://127.0.0.1:3210/api';
const DB_PATH = process.env.TEST_DB;
if (!DB_PATH) throw new Error('必须通过 TEST_DB 指定隔离 SQLite 副本');

const db = new Database(DB_PATH, { readonly: true });
const CITY_ID = 1;
const YEAR = 2026;
const MONTH = 7;
const checks = [];

function assert(name, condition, evidence) {
  checks.push({ name, passed: Boolean(condition), evidence });
  if (!condition) throw new Error(`${name}: ${JSON.stringify(evidence)}`);
  console.log(`PASS ${name}: ${JSON.stringify(evidence)}`);
}

async function api(path, { method = 'GET', token, json, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  }
  if (form !== undefined) body = form;
  const response = await fetch(`${BASE}${path}`, { method, headers, body });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: response.status, data };
}

function reportWorkbook(contractCode = 'HT-T3', completion = 701.25, acceptance = 680.5) {
  const header1 = ['', '合同名称', '合同编码', '地市', '单位'];
  const header2 = ['序号', '名称', '编码', '城市', '计量单位'];
  for (let month = 1; month <= 12; month += 1) {
    header1.push(`${month}月`, `${month}月`);
    header2.push('完成', '验收');
  }
  const row = ['', '闭环验证合同', contractCode, '淄博', '万元'];
  for (let month = 1; month <= 12; month += 1) {
    row.push(month === MONTH ? completion : null, month === MONTH ? acceptance : null);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header1, header2, row]), '合同订单明细表');
  const costHeader = ['类别'];
  const costRow = ['人工成本'];
  for (let month = 1; month <= 12; month += 1) {
    costHeader.push(`${month}月`);
    costRow.push(month === MONTH ? 301.25 : null);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([costHeader, costRow]), '成本测算表');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function costWorkbook(amount = 411.75) {
  const header = ['类别'];
  const row = ['水电费'];
  for (let month = 1; month <= 12; month += 1) {
    header.push(`${month}月`);
    row.push(month === MONTH ? amount : null);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([header, row]), '成本测算表');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

async function citySession(variableName, expectedCityId) {
  const token = process.env[variableName];
  if (!token) throw new Error(`必须通过 ${variableName} 提供 root_admin 预建的隔离 city_user 令牌`);
  const result = await api('/me', { token });
  assert(`${variableName} 为目标地市用户`, result.status === 200 && result.data?.role === 'city_user' && Number(result.data?.cityId) === Number(expectedCityId), { status: result.status, user: result.data });
  return { token, user: result.data };
}

async function uploadCity(token, jobType, buffer, fileName) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileName);
  form.append('jobType', jobType);
  form.append('reportYear', String(YEAR));
  return api('/city/import-jobs', { method: 'POST', token, form });
}

function rowCounts() {
  return {
    contracts: db.prepare('select count(*) as count from report_contract_monthly_rows').get().count,
    costs: db.prepare('select count(*) as count from report_cost_monthly_rows').get().count,
  };
}

function packageId(cityId = CITY_ID, year = YEAR) {
  return db.prepare('select id from annual_report_packages where city_id = ? and report_year = ?').get(cityId, year)?.id ?? null;
}

function contractValue() {
  const pkg = packageId();
  if (!pkg) return null;
  return db.prepare(`
    select completion_amount as completionAmount, acceptance_amount as acceptanceAmount
    from report_contract_monthly_rows
    where package_id = ? and contract_code_snapshot = 'HT-T3' and month_no = ?
  `).get(pkg, MONTH) ?? null;
}

function costValue(code) {
  const pkg = packageId();
  if (!pkg) return null;
  return db.prepare(`
    select amount from report_cost_monthly_rows
    where package_id = ? and cost_category_code = ? and month_no = ?
  `).get(pkg, code, MONTH)?.amount ?? null;
}

async function runImportChain({ label, token, jobType, buffer, fileName, expectedValue }) {
  const before = { counts: rowCounts(), value: expectedValue.read() };
  const created = await uploadCity(token, jobType, buffer, fileName);
  assert(`${label} 创建 import_jobs`, created.status === 201 && Number.isInteger(created.data?.jobId), { status: created.status, body: created.data });
  const jobId = created.data.jobId;
  const preview = await api(`/city/import-jobs/${jobId}/preview`, { token });
  assert(`${label} 获取真实解析与差异预览`, preview.status === 200 && preview.data?.parsedSummary && preview.data?.diffSummary, {
    status: preview.status,
    validation: preview.data?.parsedSummary?.validation,
    diffSummary: preview.data?.diffSummary,
  });
  assert(`${label} 预览无阻塞错误`, Array.isArray(preview.data?.qualityIssues) && preview.data.qualityIssues.length === 0, preview.data?.qualityIssues);
  const confirmed = await api(`/city/import-jobs/${jobId}/confirm`, { method: 'POST', token, json: { confirmOverwrite: true } });
  assert(`${label} 确认事务写入`, [200, 201].includes(confirmed.status) && confirmed.data?.success === true && confirmed.data?.alreadyConfirmed === false, confirmed);
  const after = { counts: rowCounts(), value: expectedValue.read() };
  assert(`${label} 业务表关键记录变化`, Number(before.value) !== expectedValue.expected && Number(after.value) === expectedValue.expected, { before, after });
  const stored = db.prepare('select status, confirmed_at as confirmedAt from import_jobs where id = ?').get(jobId);
  assert(`${label} 任务状态与 confirmed_at 落库`, stored?.status === 'completed' && Boolean(stored?.confirmedAt), stored);
  const repeat = await api(`/city/import-jobs/${jobId}/confirm`, { method: 'POST', token, json: { confirmOverwrite: true } });
  const afterRepeat = { counts: rowCounts(), value: expectedValue.read() };
  assert(`${label} 重复确认幂等`, [200, 201].includes(repeat.status) && repeat.data?.alreadyConfirmed === true && JSON.stringify(afterRepeat) === JSON.stringify(after), { repeat, after, afterRepeat });
  return { jobId, before, after };
}

async function verifyBlocked(token) {
  const before = rowCounts();
  const created = await uploadCity(token, 'city_reporting', reportWorkbook('UNKNOWN-CONTRACT', 99, 88), 'blocked-report.xlsx');
  assert('阻塞任务创建', created.status === 201, created);
  const jobId = created.data.jobId;
  const preview = await api(`/city/import-jobs/${jobId}/preview`, { token });
  assert('错误 JSON 转为结构化质量问题', preview.status === 200 && preview.data?.qualityIssues?.some((issue) => issue.blocking && issue.description.includes('不存在')), preview.data?.qualityIssues);
  const confirm = await api(`/city/import-jobs/${jobId}/confirm`, { method: 'POST', token, json: { confirmOverwrite: true } });
  const after = rowCounts();
  assert('阻塞错误拒绝确认', confirm.status === 400, confirm);
  assert('阻塞错误不产生部分写入', JSON.stringify(before) === JSON.stringify(after), { before, after });
  const stored = db.prepare('select status, confirmed_at as confirmedAt from import_jobs where id = ?').get(jobId);
  assert('阻塞任务未确认', stored?.status === 'previewed' && stored?.confirmedAt === null, stored);
  return jobId;
}

async function verifyAdmin(adminToken, jobId, cancelToken) {
  const list = await api(`/admin/import-jobs?cityId=${CITY_ID}&reportYear=${YEAR}&status=completed&page=1&pageSize=10`, { token: adminToken });
  assert('管理员任务列表支持筛选与分页', list.status === 200 && list.data?.items?.some((item) => item.id === jobId), { status: list.status, total: list.data?.total, ids: list.data?.items?.map((item) => item.id) });
  const detail = await api(`/admin/import-jobs/${jobId}`, { token: adminToken });
  assert('管理员读取任务详情', detail.status === 200 && detail.data?.id === jobId && detail.data?.operatorName && detail.data?.cityName, detail.data);
  const preview = await api(`/admin/import-jobs/${jobId}/preview`, { token: adminToken });
  assert('管理员读取持久化预览', preview.status === 200 && preview.data?.parsedSummary && preview.data?.diffSummary, { status: preview.status, id: preview.data?.id });

  const cancellable = await uploadCity(cancelToken, 'city_cost', costWorkbook(512.5), 'cancel-me.xlsx');
  const cancel = await api(`/admin/import-jobs/${cancellable.data.jobId}/cancel`, { method: 'POST', token: adminToken, json: {} });
  assert('管理员真实取消任务', cancel.status === 201 && cancel.data?.status === 'cancelled', cancel);
}

async function verifyMonthFlow(token) {
  const targetYear = 2099;
  const current = await api(`/city/packages/current?year=${targetYear}`, { token });
  assert('获取隔离年度工作上下文', current.status === 200 && Number.isInteger(current.data?.id), { status: current.status, id: current.data?.id });
  const packageIdValue = current.data.id;
  const monthData = await api(`/city/packages/${packageIdValue}/months/${MONTH}`, { token });
  assert('读取月度草稿上下文', monthData.status === 200 && Array.isArray(monthData.data?.contractRows), { status: monthData.status, contractRows: monthData.data?.contractRows?.length });
  const contractRows = monthData.data.contractRows.map((row, index) => ({
    contractId: Number(row.contractId),
    completionAmount: 120 + index,
    acceptanceAmount: 110 + index,
    invoiceAmount: 100 + index,
    orderAmount: 130 + index,
  }));
  const costRows = ['labor', 'utilities', 'fuel', 'entertainment', 'rent', 'reimbursement', 'other']
    .map((costCategoryCode, index) => ({ costCategoryCode, amount: 10 + index }));
  const payload = { monthNo: MONTH, contractRows, costRows };
  const draft = await api(`/city/packages/${packageIdValue}/draft-save`, { method: 'POST', token, json: payload });
  assert('draft-save 写入草稿', draft.status === 200 && draft.data?.success === true, draft);
  const preview = await api(`/city/packages/${packageIdValue}/submit-preview`, { method: 'POST', token, json: payload });
  assert('submit-preview 返回真实汇总校验', preview.status === 200 && preview.data?.belongMonth === MONTH && typeof preview.data?.completionTotal === 'number', preview);
  const submitted = await api(`/city/packages/${packageIdValue}/submit`, { method: 'POST', token, json: payload });
  assert('submit 生成 month_snapshots', submitted.status === 200 && submitted.data?.success === true, submitted);
  const snapshot = db.prepare('select id, actual_submited_at as submittedAt from month_snapshots where package_id = ? and belong_month = ?').get(packageIdValue, MONTH);
  assert('month_snapshots 真实落库', Boolean(snapshot?.id) && Boolean(snapshot?.submittedAt), snapshot);
  const readOnly = await api(`/city/packages/${packageIdValue}/read-only-months/${MONTH}`, { token });
  assert('提交后只读接口读取快照', readOnly.status === 200 && readOnly.data?.isSubmitted === true && Array.isArray(readOnly.data?.snapshot?.contractRows) && readOnly.data.snapshot.contractRows.length === contractRows.length, {
    status: readOnly.status,
    isSubmitted: readOnly.data?.isSubmitted,
    contractRowCount: readOnly.data?.snapshot?.contractRows?.length,
  });
  const operationCount = db.prepare(`
    select count(*) as count from operation_logs
    where target_type in ('annual_report_package', 'month_snapshot') and (target_id = ? or target_id = ?)
  `).get(String(packageIdValue), String(snapshot.id)).count;
  assert('月度关键操作写入 operation_logs', operationCount > 0, { operationCount });
}

async function main() {
  const otherCity = db.prepare('select id, name from cities where id <> ? and is_deleted = 0 order by id limit 1').get(CITY_ID);
  assert('隔离库存在第二地市', Boolean(otherCity?.id), otherCity);
  const owner = await citySession('IMPORT_LOOP_OWNER_TOKEN', CITY_ID);
  const outsider = await citySession('IMPORT_LOOP_OUTSIDER_TOKEN', Number(otherCity.id));
  const adminToken = process.env.IMPORT_LOOP_SYSTEM_ADMIN_TOKEN;
  if (!adminToken) throw new Error('必须通过 IMPORT_LOOP_SYSTEM_ADMIN_TOKEN 提供隔离 system_admin 令牌');
  const adminMe = await api('/me', { token: adminToken });
  assert('系统管理员令牌来自隔离账号', adminMe.status === 200 && adminMe.data?.role === 'system_admin', { status: adminMe.status, user: adminMe.data });

  const report = await runImportChain({
    label: '经营报表导入', token: owner.token, jobType: 'city_reporting', buffer: reportWorkbook(), fileName: 'production-report.xlsx',
    expectedValue: { read: () => contractValue()?.completionAmount ?? null, expected: 701.25 },
  });
  const cost = await runImportChain({
    label: '成本导入', token: owner.token, jobType: 'city_cost', buffer: costWorkbook(), fileName: 'production-cost.xlsx',
    expectedValue: { read: () => costValue('utilities'), expected: 411.75 },
  });
  await verifyBlocked(owner.token);

  for (const operation of ['GET', 'PREVIEW', 'CONFIRM']) {
    const path = operation === 'GET'
      ? `/city/import-jobs/${report.jobId}`
      : operation === 'PREVIEW'
        ? `/city/import-jobs/${report.jobId}/preview`
        : `/city/import-jobs/${report.jobId}/confirm`;
    const result = await api(path, operation === 'CONFIRM'
      ? { method: 'POST', token: outsider.token, json: { confirmOverwrite: true } }
      : { token: outsider.token });
    assert(`跨地市 ${operation} 被拒绝`, result.status === 403, { status: result.status, message: result.data?.message });
  }

  await verifyAdmin(adminToken, report.jobId, owner.token);
  await verifyMonthFlow(owner.token);
  const importAuditCount = db.prepare(`select count(*) as count from operation_logs where target_type = 'import_job' and action_type like 'import_%'`).get().count;
  assert('上传/预览/确认/取消写入 operation_logs', importAuditCount >= 8, { importAuditCount });

  console.log(`SUMMARY ${JSON.stringify({ passed: checks.length, failed: 0, report, cost, dbPath: DB_PATH })}`);
}

main()
  .catch((error) => {
    console.error(`FAILED ${error instanceof Error ? error.stack : String(error)}`);
    process.exitCode = 1;
  })
  .finally(() => db.close());
