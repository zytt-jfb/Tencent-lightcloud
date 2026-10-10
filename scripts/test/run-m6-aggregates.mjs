import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const apiRoot = path.join(repoRoot, 'apps', 'api');
const requireFromApi = createRequire(path.join(apiRoot, 'package.json'));
const { DataSource } = requireFromApi('typeorm');
const XLSX = requireFromApi('xlsx');

const testRoot = mkdtempSync(path.join(tmpdir(), 'biz-m6-agg-'));
const useMysql = !!process.env.BIZ_TEST_MYSQL_DATABASE;
const database = useMysql ? process.env.BIZ_TEST_MYSQL_DATABASE : path.join(testRoot, 'test.sqlite');
const storageRoot = path.join(testRoot, 'source-files');
const env = {
  ...process.env,
  NODE_ENV: 'test', DB_TYPE: useMysql ? 'mysql' : 'sqlite', DB_DATABASE: database, DB_SYNC: 'false',
  DB_HOST: useMysql ? process.env.MIGRATION_TEST_MYSQL_HOST : undefined,
  DB_PORT: useMysql ? process.env.MIGRATION_TEST_MYSQL_PORT : undefined,
  DB_USERNAME: useMysql ? process.env.MIGRATION_TEST_MYSQL_USER : undefined,
  DB_PASSWORD: useMysql ? process.env.MIGRATION_TEST_MYSQL_PASSWORD : undefined,
  FACT_SOURCE_STORAGE_ROOT: storageRoot,
  JWT_SECRET: 'm6-test-jwt-secret-0123456789abcdef',
  AUTH_SECURITY_HMAC_KEY: 'm6-test-hmac-key-0123456789abcdef',
  JWT_ISSUER: 'biz-reporting-api', JWT_AUDIENCE: 'biz-reporting-clients',
  PORT: '0',
};

function createDirectDataSource() {
  return new DataSource({
    type: useMysql ? 'mysql' : 'better-sqlite3',
    database,
    ...(useMysql ? {
      host: env.DB_HOST,
      port: Number(env.DB_PORT),
      username: env.DB_USERNAME,
      password: env.DB_PASSWORD,
    } : {}),
    synchronize: false,
    entities: [path.join(apiRoot, 'dist', '**', '*.entity.js')],
  });
}

const HEADER = ['省份名称','地市名称','采购订单编号','供应商名称','订单主状态','含税总金额','物料名称','物料编码','合同编号','净价','运保费','建安费','费用类型','税率','税额','含税单价','采购数量','计量单位','收货人','收货人联系方式','收货人详细地址','通知人','下单时间','通知时间','附言信息','项目编号','项目名称','站址编号','站址信息','收货状态','商品名称','商品编号','物料源头贴签标识','是否补样订单'];

let apiProcess;
let baseUrl = '';
let superToken = '';
let adminToken = '';
let cityToken = '';
let jinanId = '';
let contractId = '';
let shandongId = '';

async function waitForApi(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/biz/auth/me`);
      if (res.status === 401 || res.status === 200) return;
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('API did not become ready');
}

async function api(method, urlPath, { token, body, form } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(`${baseUrl}${urlPath}`, { method, headers, body: payload });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function buildOrderBuffer(rows) {
  const aoa = [HEADER, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '电商化订单列表');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function makeRow(po, amount, orderTime) {
  const row = new Array(34).fill('');
  row[0] = '山东省'; row[1] = '济南市'; row[2] = po; row[5] = String(amount);
  row[8] = 'HT-AGG-001'; row[19] = '13800138000'; row[22] = orderTime;
  return row;
}

async function uploadAndWait(buffer) {
  const form = new FormData();
  form.append('idempotencyKey', randomUUID());
  form.append('file', new Blob([buffer]), 'agg-orders.xlsx');
  const up = await api('POST', '/biz/orders/upload', { token: superToken, form });
  assert.equal(up.status, 201);
  for (let i = 0; i < 100; i++) {
    const d = await api('GET', `/biz/orders/batches/${up.data.batchId}`, { token: superToken });
    if (d.data.batch.status !== 'parsing') {
      assert.equal(d.data.batch.status, 'imported', d.data.batch.failureReason);
      return d.data.batch;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('batch timeout');
}

try {
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, ['scripts/db/migrate.mjs', 'up'], { cwd: repoRoot, env, stdio: 'inherit' });
  execFileSync(process.execPath, ['scripts/auth/biz-init-super-admin.mjs'], {
    cwd: repoRoot, env: { ...env, BIZ_SUPER_ADMIN_USERNAME: 'm6_super', BIZ_SUPER_ADMIN_PASSWORD: 'M6-secret-1' }, stdio: 'inherit',
  });

  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}/api`;
  apiProcess = spawn(process.execPath, ['apps/api/dist/main.js'], {
    cwd: repoRoot, env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  apiProcess.stdout.on('data', (c) => process.stdout.write(`[api] ${c}`));
  apiProcess.stderr.on('data', (c) => process.stderr.write(`[api] ${c}`));
  await waitForApi(baseUrl);

  // 准备账号/合同
  let res = await api('POST', '/biz/auth/login', { body: { username: 'm6_super', password: 'M6-secret-1' } });
  superToken = res.data.accessToken;
  const [provs, cities] = await Promise.all([
    api('GET', '/biz/admin/provinces', { token: superToken }),
    api('GET', '/biz/admin/cities', { token: superToken }),
  ]);
  shandongId = provs.data.items.find((p) => p.code === '370000').id;
  jinanId = cities.data.items.find((c) => c.code === '370100').id;
  for (const dto of [
    { username: 'm6_admin', password: 'M6-secret-1', name: '管理员', roleCode: 'admin' },
    { username: 'm6_city', password: 'M6-secret-1', name: '地市用户', roleCode: 'city_user', cityId: jinanId },
  ]) {
    await api('POST', '/biz/admin/users', { token: superToken, body: dto });
  }
  for (const [key, username] of [['admin', 'm6_admin'], ['city', 'm6_city']]) {
    res = await api('POST', '/biz/auth/login', { body: { username, password: 'M6-secret-1' } });
    if (key === 'admin') adminToken = res.data.accessToken;
    if (key === 'city') cityToken = res.data.accessToken;
  }
  res = await api('POST', '/biz/contracts', { token: superToken, body: {
    contractNo: 'HT-AGG-001', contractName: '汇总测试合同', taxInclusiveAmountFen: 1_000_000_00,
    provinceId: shandongId, startDate: '2026-01-01', endDate: '2026-12-31',
  } });
  contractId = res.data.id;
  await api('POST', `/biz/contracts/${contractId}/allocations`, { token: superToken, body: { cityId: jinanId, quotaFen: 600_000_00 } });
  await api('POST', `/biz/contracts/${contractId}/fee-rates`, { token: superToken, body: { cityId: jinanId, effectiveMonth: '2026-01', rateBp: 1200 } });

  // ============ 明细准备：订单 10 万 + 完工 5 万 + 成本 3 万 ============
  await uploadAndWait(buildOrderBuffer([
    makeRow('AGG-ORD-1', 100_000, '2026-06-10 08:00:00'),
    makeRow('AGG-ORD-2', 100_000, '2026-06-11 09:00:00'),
  ])); // 订单 200000.00，毛利 12% = 24000.00

  const offRes = await api('POST', '/biz/offline-completions', { token: cityToken, body: {
    contractId, cityId: jinanId, businessMonth: '2026-06', amountFen: 50_000_00, summary: 'M6 完工',
  } });
  await api('POST', `/biz/offline-completions/${offRes.data.id}/submit`, { token: cityToken });
  res = await api('POST', `/biz/offline-completions/${offRes.data.id}/approve`, { token: adminToken });
  assert.equal(res.status, 201);

  const costRes = await api('POST', '/biz/costs', { token: cityToken, body: {
    cityId: jinanId, businessMonth: '2026-06', categoryCode: 'labor', amountFen: 30_000_00, description: 'M6 成本',
  } });
  await api('POST', `/biz/costs/${costRes.data.id}/submit`, { token: cityToken });
  await api('POST', `/biz/costs/${costRes.data.id}/approve`, { token: superToken });

  // 等待增量重算完成
  await new Promise((r) => setTimeout(r, 1000));

  // ============ AGG-001/002 汇总生成与维度 ============
  // 显式重算确保汇总生成（增量触发为 fire-and-forget，失败仅记录）
  const failRes = await api('GET', '/biz/aggregates/failures', { token: adminToken });
  console.error('  [AGG] failures before recalc:', JSON.stringify(failRes.data.items?.map((f) => ({ err: f.error?.slice(0, 300), scope: f.scopeDesc }))));
  res = await api('POST', '/biz/aggregates/recalc', { token: adminToken, body: { scope: {}, confirmAll: true } });
  if (res.status !== 201) {
    const f2 = await api('GET', '/biz/aggregates/failures', { token: adminToken });
    console.error('  [AGG] failures after recalc:', JSON.stringify(f2.data.items?.map((f) => f.error?.slice(0, 300))));
  }
  assert.equal(res.status, 201, `recalc failed: ${JSON.stringify(res.data)}`);
  {
    const ds = createDirectDataSource();
    await ds.initialize();
    const aggRepo = ds.getRepository('BizMonthlyAggregateEntity');
    const contractAgg = await aggRepo.findOneBy({ contractId, businessMonth: '2026-06' });
    assert.ok(contractAgg, 'AGG-001 contract-month aggregate exists');
    assert.equal(Number(contractAgg.orderCompletionFen), 200_000_00, 'AGG-001 order 200000.00');
    assert.equal(Number(contractAgg.offlineCompletionFen), 50_000_00, 'AGG-001 offline 50000.00');
    assert.equal(Number(contractAgg.grossProfitFen), 30_000_00, 'AGG-001 gross profit 30000.00 = (order 200000 + offline 50000) x 12%');
    // 成本行（地市维度，contractId=NULL）
    const costAgg = await aggRepo.createQueryBuilder('a')
      .where('a.cityId = :cityId AND a.contractId IS NULL AND a.businessMonth = :month', { cityId: jinanId, month: '2026-06' })
      .getOne();
    assert.ok(costAgg, 'AGG-002 cost dimension row exists');
    assert.equal(Number(costAgg.costFen), 30_000_00, 'AGG-002 cost 30000.00');
    await ds.destroy();
  }

  // ============ AGG-006 利润=收入-成本 ============
  res = await api('GET', '/biz/analysis/overview', { token: adminToken });
  assert.equal(res.status, 200);
  assert.equal(res.data.grossProfitFen, 30_000_00, 'AGG-006 gross 30000 (incl offline profit)');
  assert.equal(res.data.costFen, 30_000_00, 'AGG-006 cost 30000');
  assert.equal(res.data.netProfitFen, 0, 'AGG-006 net = gross - cost = 30000 - 30000 = 0');

  // ============ AGG-007 累计/趋势/地市 ============
  res = await api('GET', '/biz/analysis/trend', { token: adminToken });
  assert.ok(res.data.items.length >= 1 && Number(res.data.items[0].orderCompletionFen) === 200_000_00, 'AGG-007 trend');
  res = await api('GET', '/biz/analysis/by-city', { token: adminToken });
  const jinanRow = res.data.items.find((r) => r.cityId === jinanId);
  assert.ok(jinanRow && Number(jinanRow.orderCompletionFen) === 200_000_00, 'AGG-007 by-city');

  // ============ AGG-009 年度筛选 + 可用年度接口 ============
  res = await api('GET', '/biz/analysis/years', { token: adminToken });
  assert.equal(res.status, 200, 'AGG-009 years status');
  const yearItems = res.data.items;
  assert.ok(Array.isArray(yearItems) && yearItems.includes('2026'), 'AGG-009 years include 2026 (business month exists)');
  assert.ok(yearItems.includes(String(new Date().getFullYear())), 'AGG-009 years include current year');
  res = await api('GET', '/biz/analysis/overview?year=2026', { token: adminToken });
  assert.equal(res.data.orderCompletionFen, 200_000_00, 'AGG-009 year=2026 overview order 200000.00');
  assert.equal(res.data.offlineCompletionFen, 50_000_00, 'AGG-009 year=2026 overview offline 50000.00');
  res = await api('GET', '/biz/analysis/trend?year=2026', { token: adminToken });
  assert.ok(res.data.items.length >= 1 && Number(res.data.items[0].orderCompletionFen) === 200_000_00, 'AGG-009 trend year=2026');
  res = await api('GET', '/biz/analysis/by-city?year=2026', { token: adminToken });
  assert.ok(res.data.items.find((r) => r.cityId === jinanId && Number(r.orderCompletionFen) === 200_000_00), 'AGG-009 by-city year=2026');
  res = await api('GET', '/biz/analysis/overview?year=2025', { token: adminToken });
  assert.equal(res.data.orderCompletionFen, 0, 'AGG-009 year=2025 no data -> 0');
  res = await api('GET', '/biz/analysis/overview?year=2026&month=2026-06', { token: adminToken });
  assert.equal(res.data.orderCompletionFen, 200_000_00, 'AGG-009 year+month=2026-06 overview order 200000.00');

  // ============ AGG-003 订单批次作废退出统计 ============
  {
    const ds = createDirectDataSource();
    await ds.initialize();
    const batchRepo = ds.getRepository('BizOrderImportBatchEntity');
    const batch = await batchRepo.findOneBy({ filename: 'agg-orders.xlsx' });
    await ds.destroy();
    res = await api('POST', `/biz/orders/batches/${batch.id}/void`, { token: superToken, body: { reason: 'AGG-003 作废' } });
    assert.equal(res.status, 201);
  }
  await new Promise((r) => setTimeout(r, 1000));
  res = await api('GET', '/biz/analysis/overview', { token: adminToken });
  assert.equal(res.data.orderCompletionFen, 0, 'AGG-003 voided batch excluded from summary');

  // ============ AGG-004 完工作废退出 ============
  res = await api('POST', `/biz/offline-completions/${offRes.data.id}/void`, { token: adminToken, body: { reason: 'AGG-004' } });
  assert.equal(res.status, 201);
  await new Promise((r) => setTimeout(r, 1000));
  res = await api('GET', '/biz/analysis/overview', { token: adminToken });
  assert.equal(res.data.offlineCompletionFen, 0, 'AGG-004 voided offline excluded');

  // ============ AGG-008 超额清单 ============
  await uploadAndWait(buildOrderBuffer([makeRow('AGG-ORD-3', 1_100_000, '2026-06-12 08:00:00')]));
  await api('POST', '/biz/aggregates/recalc', { token: adminToken, body: { scope: {}, confirmAll: true } });
  res = await api('GET', '/biz/analysis/overrun-list', { token: adminToken });
  console.error('  [AGG-008] overrun-list:', JSON.stringify(res.data.items));
  const contractOverrun = res.data.items.find((i) => i.type === 'contract' && (i.contractId ?? i.id) === contractId);
  assert.ok(contractOverrun, 'AGG-008 contract overrun listed');
  assert.equal(Number(contractOverrun.overrunFen), 100_000_00, 'AGG-008 overrun 110w-100w=10w');
  const cityOverrun = res.data.items.find((i) => i.type === 'city' && i.cityId === jinanId);
  assert.ok(cityOverrun && Number(cityOverrun.overrunFen) === 500_000_00, 'AGG-008 city overrun 110w-60w=50w');

  // ============ REC-001 失败范围优先 / 全库需确认 ============
  res = await api('POST', '/biz/aggregates/recalc', { token: adminToken, body: { scope: {} } });
  assert.equal(res.status, 400, 'REC-001 full recalc without confirmAll rejected');
  res = await api('POST', '/biz/aggregates/recalc', { token: adminToken, body: { scope: {}, confirmAll: true } });
  assert.equal(res.status, 201, 'REC-001 confirmAll full recalc OK');
  res = await api('POST', '/biz/aggregates/recalc', { token: adminToken, body: { scope: { contractId } } });
  assert.equal(res.status, 201, 'REC-003 scoped recalc OK');

  // ============ REC-002 权限：city_user 无重算权限 ============
  res = await api('POST', '/biz/aggregates/recalc', { token: cityToken, body: { scope: { contractId }, confirmAll: true } });
  assert.equal(res.status, 403, 'REC-002 city_user no recalc permission');

  // ============ CNS-001 一致性核对（一致时无警告） ============
  res = await api('POST', '/biz/aggregates/check', { token: adminToken });
  assert.equal(res.status, 201);
  assert.equal(res.data.warningCount, 0, `CNS-001 no warnings: ${JSON.stringify(res.data.warnings?.slice(0, 2))}`);

  // ============ CNS-002/003 篡改后核对告警且不自动改写 ============
  {
    const ds = createDirectDataSource();
    await ds.initialize();
    const aggRepo = ds.getRepository('BizMonthlyAggregateEntity');
    const contractAgg = await aggRepo.findOneBy({ contractId, businessMonth: '2026-06' });
    contractAgg.netProfitFen = Number(contractAgg.netProfitFen) + 999;
    await aggRepo.save(contractAgg);
    await ds.destroy();
  }
  res = await api('POST', '/biz/aggregates/check', { token: adminToken });
  assert.ok(res.data.warningCount >= 1 && res.data.warnings.some((w) => w.type === 'net_profit_mismatch'), 'CNS-002 net profit mismatch detected');
  // CNS-003：核对不改写数据
  {
    const ds = createDirectDataSource();
    await ds.initialize();
    const aggRepo = ds.getRepository('BizMonthlyAggregateEntity');
    const contractAgg = await aggRepo.findOneBy({ contractId, businessMonth: '2026-06' });
    assert.equal(Number(contractAgg.netProfitFen) % 100, 99, 'CNS-003 check did not auto-rewrite data');
    await ds.destroy();
  }

  // ============ DEV-055 系统设置 ============
  res = await api('GET', '/biz/settings', { token: adminToken });
  assert.equal(res.status, 200);
  assert.equal(res.data.items.length, 3, 'DEV-055 settings seeded 3 items');
  res = await api('PUT', '/biz/settings/contract_expiry_warning_days', { token: cityToken, body: { value: '30' } });
  assert.equal(res.status, 403, 'DEV-055 city_user no settings manage');
  res = await api('PUT', '/biz/settings/contract_expiry_warning_days', { token: superToken, body: { value: '30' } });
  assert.equal(res.status, 200, 'DEV-055 super updates setting');

  // ============ 合同详情完整聚合（DEV-053） ============
  res = await api('GET', `/biz/contracts/${contractId}`, { token: adminToken });
  assert.ok(res.data.finance, 'DEV-053 contract detail has finance');
  // 此时订单：AGG-ORD-1/2 批次已作废退出，仅剩 AGG-ORD-3（110 万，毛利 13.2 万）
  // 成本不关联合同：按分配地市汇总为参考值（referenceCostFen），一市多合同会重复计入，不用于净利润口径
  assert.equal(res.data.finance.isReference, true, 'DEV-053 finance is reference (cost not contract-bound)');
  assert.equal(res.data.finance.referenceCostFen, 30_000_00, 'DEV-053 reference cost 30000');
  assert.equal(res.data.finance.grossProfitFen, 132_000_00, 'DEV-053 gross 132000 (110w x 12%)');
  assert.equal(res.data.finance.referenceNetProfitFen, 102_000_00, 'DEV-053 reference net 132000-30000=102000');

  console.log('M6_AGG_OK AGG-001..009 + REC-001..003 + CNS-001..003 all passed + DEV-055 settings + DEV-053 contract finance');
} finally {
  if (apiProcess && apiProcess.exitCode === null) apiProcess.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1000));
  try {
    rmSync(testRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 });
  } catch {
    console.log('M6_AGG_CLEANUP_WARN');
  }
  console.log('M6_AGG_CLEANUP_OK');
}
