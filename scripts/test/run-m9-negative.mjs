/**
 * M8 修复负向测试（DEV-9）：
 *  - 线下利润：完工毛利 = 金额 × 费率快照；汇总含完工毛利
 *  - 省级重算：province scope 重算正确（完工/成本按省过滤，完工表无 province_id）
 *  - 跨省上传：省范围 admin 上传外省行 → 行级 scope 错误
 *  - 混合批次：范围内行导入 + 范围外行 error
 *  - 跨地市：city_user 创建外地市完工/成本 → 403
 *  - 权限覆盖：city_user 即使被 override 授予 order.upload 仍因 role 硬限制被拒
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
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

const testRoot = mkdtempSync(path.join(tmpdir(), 'biz-m9-neg-'));
const useMysql = !!process.env.BIZ_TEST_MYSQL_DATABASE;
const database = useMysql ? process.env.BIZ_TEST_MYSQL_DATABASE : path.join(testRoot, 'm9.sqlite');
const storageRoot = path.join(testRoot, 'source-files');
const env = {
  ...process.env,
  NODE_ENV: 'test', DB_TYPE: useMysql ? 'mysql' : 'sqlite', DB_DATABASE: database, DB_SYNC: 'false',
  DB_HOST: useMysql ? process.env.MIGRATION_TEST_MYSQL_HOST : undefined,
  DB_PORT: useMysql ? process.env.MIGRATION_TEST_MYSQL_PORT : undefined,
  DB_USERNAME: useMysql ? process.env.MIGRATION_TEST_MYSQL_USER : undefined,
  DB_PASSWORD: useMysql ? process.env.MIGRATION_TEST_MYSQL_PASSWORD : undefined,
  FACT_SOURCE_STORAGE_ROOT: storageRoot,
  JWT_SECRET: 'm9-test-jwt-secret-0123456789abcdef',
  AUTH_SECURITY_HMAC_KEY: 'm9-test-hmac-key-0123456789abcdef',
  JWT_ISSUER: 'biz-reporting-api', JWT_AUDIENCE: 'biz-reporting-clients',
  PORT: '0',
};

const HEADER = ['省份名称','地市名称','采购订单编号','供应商名称','订单主状态','含税总金额','物料名称','物料编码','合同编号','净价','运保费','建安费','费用类型','税率','税额','含税单价','采购数量','计量单位','收货人','收货人联系方式','收货人详细地址','通知人','下单时间','通知时间','附言信息','项目编号','项目名称','站址编号','站址信息','收货状态','商品名称','商品编号','物料源头贴签标识','是否补样订单'];

let apiProcess;
let baseUrl = '';
let superToken = '';
let adminToken = '';
let cityToken = '';
let jinanId = '';
let dezhouId = '';
let shandongId = '';
let contractId = '';

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

function makeRow(po, amount, orderTime, province = '山东省', city = '济南市', contractNo = 'HT-NEG-1') {
  const row = new Array(34).fill('');
  row[0] = province; row[1] = city; row[2] = po; row[5] = String(amount);
  row[8] = contractNo; row[22] = orderTime;
  return row;
}

async function uploadAndWait(buffer, token) {
  const form = new FormData();
  form.append('idempotencyKey', randomUUID());
  form.append('file', new Blob([buffer]), 'neg-orders.xlsx');
  const up = await api('POST', '/biz/orders/upload', { token, form });
  if (up.status !== 201) return up;
  for (let i = 0; i < 100; i++) {
    const d = await api('GET', `/biz/orders/batches/${up.data.batchId}`, { token });
    if (d.data.batch.status !== 'parsing') return { status: 201, data: d.data };
    await new Promise((r) => setTimeout(r, 200));
  }
  return up;
}

try {
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, ['scripts/db/migrate.mjs', 'up'], { cwd: repoRoot, env, stdio: 'inherit' });
  execFileSync(process.execPath, ['scripts/auth/biz-init-super-admin.mjs'], {
    cwd: repoRoot, env: { ...env, BIZ_SUPER_ADMIN_USERNAME: 'm9_super', BIZ_SUPER_ADMIN_PASSWORD: 'M9-secret-1' }, stdio: 'inherit',
  });

  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}/api`;
  apiProcess = spawn(process.execPath, ['apps/api/dist/main.js'], {
    cwd: repoRoot, env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  apiProcess.stderr.on('data', (c) => process.stderr.write(`[api] ${c}`));
  await waitForApi(baseUrl);

  // 账号与主数据
  let res = await api('POST', '/biz/auth/login', { body: { username: 'm9_super', password: 'M9-secret-1' } });
  superToken = res.data.accessToken;
  const [provs, cities] = await Promise.all([
    api('GET', '/biz/admin/provinces', { token: superToken }),
    api('GET', '/biz/admin/cities', { token: superToken }),
  ]);
  shandongId = provs.data.items.find((p) => p.code === '370000').id;
  jinanId = cities.data.items.find((c) => c.code === '370100').id;
  dezhouId = cities.data.items.find((c) => c.code === '371400').id;
  for (const dto of [
    { username: 'm9_admin', password: 'M9-secret-1', name: '省范围管理员', roleCode: 'admin' },
    { username: 'm9_city', password: 'M9-secret-1', name: '济南用户', roleCode: 'city_user', cityId: jinanId },
  ]) {
    await api('POST', '/biz/admin/users', { token: superToken, body: dto });
  }
  for (const [key, username] of [['admin', 'm9_admin'], ['city', 'm9_city']]) {
    res = await api('POST', '/biz/auth/login', { body: { username, password: 'M9-secret-1' } });
    if (key === 'admin') adminToken = res.data.accessToken;
    if (key === 'city') cityToken = res.data.accessToken;
  }

  // 合同：山东省，济南 60 万/德州 40 万，费率 2026-01 起 1200bp（济南）/800bp（德州）
  res = await api('POST', '/biz/contracts', { token: superToken, body: {
    contractNo: 'HT-NEG-1', contractName: '负向测试合同', taxInclusiveAmountFen: 1_000_000_00,
    provinceId: shandongId, startDate: '2026-01-01', endDate: '2026-12-31',
  } });
  contractId = res.data.id;
  await api('POST', `/biz/contracts/${contractId}/allocations`, { token: superToken, body: { cityId: jinanId, quotaFen: 600_000_00 } });
  await api('POST', `/biz/contracts/${contractId}/allocations`, { token: superToken, body: { cityId: dezhouId, quotaFen: 400_000_00 } });
  await api('POST', `/biz/contracts/${contractId}/fee-rates`, { token: superToken, body: { cityId: jinanId, effectiveMonth: '2026-01', rateBp: 1200 } });
  await api('POST', `/biz/contracts/${contractId}/fee-rates`, { token: superToken, body: { cityId: dezhouId, effectiveMonth: '2026-01', rateBp: 800 } });

  // ============ 1. 线下利润：完工毛利 = 金额 × 费率快照 ============
  const off = await api('POST', '/biz/offline-completions', { token: cityToken, body: {
    contractId, cityId: jinanId, businessMonth: '2026-06', amountFen: 50_000_00, summary: 'M9 完工',
  } });
  await api('POST', `/biz/offline-completions/${off.data.id}/submit`, { token: cityToken });
  res = await api('POST', `/biz/offline-completions/${off.data.id}/approve`, { token: adminToken });
  assert.equal(res.status, 201, 'approve offline');
  {
    const ds = useMysql
      ? new DataSource({ type: 'mysql', host: process.env.MIGRATION_TEST_MYSQL_HOST, port: Number(process.env.MIGRATION_TEST_MYSQL_PORT), username: process.env.MIGRATION_TEST_MYSQL_USER, password: process.env.MIGRATION_TEST_MYSQL_PASSWORD, database })
      : new DataSource({ type: 'better-sqlite3', database, synchronize: false, entities: [path.join(apiRoot, 'dist', '**', '*.entity.js')] });
    await ds.initialize();
    const offEntity = useMysql
      ? (await ds.query('SELECT id, fee_rate_snapshot_bp AS feeRateSnapshotBp, gross_profit_fen AS grossProfitFen FROM biz_offline_completions WHERE id = ?', [off.data.id]))[0]
      : await ds.getRepository('BizOfflineCompletionEntity').findOneBy({ id: off.data.id });
    assert.equal(Number(offEntity.feeRateSnapshotBp), 1200, 'M9 fee snapshot 1200bp');
    assert.equal(Number(offEntity.grossProfitFen), 6_000_00, 'M9 offline gross = 50000 x 12% = 6000');
    await ds.destroy();
  }
  // 汇总含完工毛利（仅完工时毛利=6000，成本 0）
  res = await api('POST', '/biz/aggregates/recalc', { token: superToken, body: { scope: {}, confirmAll: true } });
  assert.equal(res.status, 201);
  res = await api('GET', '/biz/analysis/overview', { token: superToken });
  assert.equal(res.data.grossProfitFen, 6_000_00, 'M9 overview gross includes offline 6000');
  assert.equal(res.data.offlineCompletionFen, 50_000_00, 'M9 overview offline 50000');

  // ============ 2. 省级重算：province scope 不崩且正确（完工/成本按省过滤） ============
  res = await api('POST', '/biz/aggregates/recalc', { token: superToken, body: { scope: { provinceId: shandongId }, confirmAll: true } });
  assert.equal(res.status, 201, `M9 province recalc: ${JSON.stringify(res.data)}`);
  res = await api('GET', '/biz/analysis/overview', { token: superToken });
  assert.equal(res.data.offlineCompletionFen, 50_000_00, 'M9 province recalc keeps offline');

  // ============ 3. 跨地市：city_user 创建德州完工/成本 → 403 ============
  res = await api('POST', '/biz/offline-completions', { token: cityToken, body: {
    contractId, cityId: dezhouId, businessMonth: '2026-06', amountFen: 10_000_00, summary: '跨地市',
  } });
  assert.equal(res.status, 403, 'M9 cross-city offline rejected (403)');
  res = await api('POST', '/biz/costs', { token: cityToken, body: {
    cityId: dezhouId, businessMonth: '2026-06', categoryCode: 'labor', amountFen: 5_000_00, description: '跨地市成本',
  } });
  assert.equal(res.status, 403, 'M9 cross-city cost rejected (403)');

  // ============ 4. 权限覆盖：city_user + override order.upload → role 硬限制仍 403 ============
  const cityUserId = (await api('GET', '/biz/admin/users', { token: superToken })).data.items.find((u) => u.username === 'm9_city').id;
  await api('PUT', `/biz/admin/users/${cityUserId}/permission-overrides`, { token: superToken, body: { overrides: [{ permissionCode: 'operation.order.upload', effect: 'allow' }] } });
  res = await uploadAndWait(buildOrderBuffer([makeRow('NEG-ORD-X', 100_000, '2026-06-10 08:00:00')]), cityToken);
  assert.equal(res.status, 403, 'M9 city_user upload rejected by role hard limit even with override');
  assert.ok(JSON.stringify(res.data).includes('super_admin'), 'M9 reject message mentions role limit');

  // ============ 5. 混合批次 + 跨地市行：地市范围 admin 上传含范围外地市行 → 行级 scope 错误 ============
  // 将 m9_admin 数据范围收窄到济南（city scope）
  const adminUserId = (await api('GET', '/biz/admin/users', { token: superToken })).data.items.find((u) => u.username === 'm9_admin').id;
  res = await api('PUT', `/biz/admin/users/${adminUserId}/data-scopes`, { token: superToken, body: { scopes: [{ provinceId: shandongId, cityId: jinanId }] } });
  assert.equal(res.status, 200, 'set admin city scope (济南)');
  // 重新登录（authVersion 变化）
  res = await api('POST', '/biz/auth/login', { body: { username: 'm9_admin', password: 'M9-secret-1' } });
  adminToken = res.data.accessToken;

  // 混合批次：济南行（范围内）+ 德州行（范围外 → 行级 scope 错误）；策略=任一错误整批失败零写入 + 错误报告
  res = await uploadAndWait(buildOrderBuffer([
    makeRow('NEG-ORD-1', 100_000, '2026-06-10 08:00:00', '山东省', '济南市', 'HT-NEG-1'),
    makeRow('NEG-ORD-2', 50_000, '2026-06-11 08:00:00', '山东省', '德州市', 'HT-NEG-1'),
  ]), adminToken);
  assert.equal(res.status, 201, 'mixed batch uploaded');
  const batchData = res.data;
  assert.equal(batchData.batch.status, 'failed', `M9 mixed batch failed (any error => whole batch rollback): ${batchData.batch.failureReason}`);
  const scopeErrors = (batchData.errors ?? []).filter((e) => (e.type ?? e.errorType) === 'scope');
  assert.ok(scopeErrors.length >= 1, `M9 cross-city row rejected by scope: ${JSON.stringify(batchData.errors?.slice(0, 2))}`);
  // 零写入：范围内行也未导入（整批回滚）
  res = await api('GET', '/biz/analysis/overview', { token: superToken });
  assert.equal(res.data.orderCompletionFen, 0, 'M9 whole batch rollback: no rows imported');
  // 上传者（admin）可查看自己上传的失败批次详情（第 7 项）
  res = await api('GET', `/biz/orders/batches/${batchData.batch.id}`, { token: adminToken });
  assert.equal(res.status, 200, 'M9 uploader can view own failed batch');
  assert.equal(res.data.batch.id, batchData.batch.id);

  console.log('M9_NEGATIVE_OK offline-profit + province-recalc + cross-city-403 + override-role-limit + mixed-batch-scope all passed');
} finally {
  if (apiProcess && apiProcess.exitCode === null) apiProcess.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1000));
  try { rmSync(testRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 }); } catch { console.log('M9_NEGATIVE_CLEANUP_WARN'); }
  console.log('M9_NEGATIVE_CLEANUP_OK');
}
