/**
 * M11 业务正确性测试（治理三次返工）：
 *  - 零进度合同计入首页/地市指标（合同+分配表出发，经营金额左连接汇总）
 *  - 提醒实时计算：不调用手工 refresh-alerts 也能产生到期/满额提醒
 *  - 整页组合筛选：overrun-list/analysis-alerts 支持 month/cityId
 *  - 共享合同进度口径：city 范围详情 progressBasis=city-quota（本地市完工/本地市配额），super 为 contract
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

const testRoot = mkdtempSync(path.join(tmpdir(), 'biz-m11-biz-'));
const useMysql = !!process.env.BIZ_TEST_MYSQL_DATABASE;
const database = useMysql ? process.env.BIZ_TEST_MYSQL_DATABASE : path.join(testRoot, 'm11.sqlite');
const env = {
  ...process.env,
  NODE_ENV: 'test', DB_TYPE: useMysql ? 'mysql' : 'sqlite', DB_DATABASE: database, DB_SYNC: 'false',
  DB_HOST: useMysql ? process.env.MIGRATION_TEST_MYSQL_HOST : undefined,
  DB_PORT: useMysql ? process.env.MIGRATION_TEST_MYSQL_PORT : undefined,
  DB_USERNAME: useMysql ? process.env.MIGRATION_TEST_MYSQL_USER : undefined,
  DB_PASSWORD: useMysql ? process.env.MIGRATION_TEST_MYSQL_PASSWORD : undefined,
  FACT_SOURCE_STORAGE_ROOT: path.join(testRoot, 'src'),
  JWT_SECRET: 'm11-test-jwt-secret-0123456789abcdef',
  AUTH_SECURITY_HMAC_KEY: 'm11-test-hmac-key-0123456789abcdef',
  JWT_ISSUER: 'biz-reporting-api', JWT_AUDIENCE: 'biz-reporting-clients',
  PORT: '0',
};

let apiProcess;
let baseUrl = '';
let superToken = '';
let jinanId = '';
let dezhouId = '';
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

async function api(method, urlPath, { token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${baseUrl}${urlPath}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
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

try {
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, ['scripts/db/migrate.mjs', 'up'], { cwd: repoRoot, env, stdio: 'inherit' });
  execFileSync(process.execPath, ['scripts/auth/biz-init-super-admin.mjs'], {
    cwd: repoRoot, env: { ...env, BIZ_SUPER_ADMIN_USERNAME: 'm11_super', BIZ_SUPER_ADMIN_PASSWORD: 'M11-secret-1' }, stdio: 'inherit',
  });

  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}/api`;
  apiProcess = spawn(process.execPath, ['apps/api/dist/main.js'], {
    cwd: repoRoot, env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  apiProcess.stderr.on('data', (c) => process.stderr.write(`[api] ${c}`));
  await waitForApi(baseUrl);

  let res = await api('POST', '/biz/auth/login', { body: { username: 'm11_super', password: 'M11-secret-1' } });
  superToken = res.data.accessToken;
  const [provs, cities] = await Promise.all([
    api('GET', '/biz/admin/provinces', { token: superToken }),
    api('GET', '/biz/admin/cities', { token: superToken }),
  ]);
  shandongId = provs.data.items.find((p) => p.code === '370000').id;
  jinanId = cities.data.items.find((c) => c.code === '370100').id;
  dezhouId = cities.data.items.find((c) => c.code === '371400').id;

  // 济南范围管理员（city scope）
  await api('POST', '/biz/admin/users', { token: superToken, body: { username: 'm11_admin', password: 'M11-secret-1', name: '济南管理员', roleCode: 'admin' } });
  const adminUserId = (await api('GET', '/biz/admin/users', { token: superToken })).data.items.find((u) => u.username === 'm11_admin').id;
  await api('PUT', `/biz/admin/users/${adminUserId}/data-scopes`, { token: superToken, body: { scopes: [{ provinceId: shandongId, cityId: jinanId }] } });
  res = await api('POST', '/biz/auth/login', { body: { username: 'm11_admin', password: 'M11-secret-1' } });
  const adminToken = res.data.accessToken;

  const today = new Date();
  const endSoon = new Date(today.getTime() + 10 * 86400000).toISOString().slice(0, 10);
  const endFar = new Date(today.getTime() + 365 * 86400000).toISOString().slice(0, 10);

  // C1 零进度合同：济南分配 50 万，无订单/完工
  const c1 = await api('POST', '/biz/contracts', { token: superToken, body: {
    contractNo: 'HT-M11-ZERO', contractName: '零进度合同', taxInclusiveAmountFen: 500_000_00,
    provinceId: shandongId, startDate: '2026-01-01', endDate: endFar,
  } });
  await api('POST', `/biz/contracts/${c1.data.id}/allocations`, { token: superToken, body: { cityId: jinanId, quotaFen: 500_000_00 } });
  // C2 近到期合同（不调 refresh-alerts）：济南分配 80 万，endDate=10 天后
  const c2 = await api('POST', '/biz/contracts', { token: superToken, body: {
    contractNo: 'HT-M11-EXP', contractName: '近到期合同', taxInclusiveAmountFen: 800_000_00,
    provinceId: shandongId, startDate: '2026-01-01', endDate: endSoon,
  } });
  await api('POST', `/biz/contracts/${c2.data.id}/allocations`, { token: superToken, body: { cityId: jinanId, quotaFen: 800_000_00 } });
  // C3 满额合同：济南分配 100 万，济南完工 120 万
  const c3 = await api('POST', '/biz/contracts', { token: superToken, body: {
    contractNo: 'HT-M11-FULL', contractName: '满额合同', taxInclusiveAmountFen: 1_000_000_00,
    provinceId: shandongId, startDate: '2026-01-01', endDate: endFar,
  } });
  await api('POST', `/biz/contracts/${c3.data.id}/allocations`, { token: superToken, body: { cityId: jinanId, quotaFen: 1_000_000_00 } });
  // C4 共享合同：济南 60 万 + 德州 40 万，济南完工 10 万
  const c4 = await api('POST', '/biz/contracts', { token: superToken, body: {
    contractNo: 'HT-M11-SHARED', contractName: '共享合同', taxInclusiveAmountFen: 1_000_000_00,
    provinceId: shandongId, startDate: '2026-01-01', endDate: endFar,
  } });
  await api('POST', `/biz/contracts/${c4.data.id}/allocations`, { token: superToken, body: { cityId: jinanId, quotaFen: 600_000_00 } });
  await api('POST', `/biz/contracts/${c4.data.id}/allocations`, { token: superToken, body: { cityId: dezhouId, quotaFen: 400_000_00 } });

  // 完工：C3 济南 120 万、C4 济南 10 万（submit+approve，费率 0 不影响进度）
  const mkOffline = async (contractId, amountFen) => {
    const o = await api('POST', '/biz/offline-completions', { token: superToken, body: {
      contractId, cityId: jinanId, businessMonth: '2026-06', amountFen, summary: 'M11 完工',
    } });
    await api('POST', `/biz/offline-completions/${o.data.id}/submit`, { token: superToken });
    const ap = await api('POST', `/biz/offline-completions/${o.data.id}/approve`, { token: superToken });
    assert.ok([200, 201].includes(ap.status), `M11 offline approve ${contractId}`);
  };
  await mkOffline(c3.data.id, 1_200_000_00);
  await mkOffline(c4.data.id, 100_000_00);

  // ============ 2b. 地市范围 byCity：济南管理员只返回济南，不泄露德州分配 ============
  res = await api('GET', '/biz/analysis/by-city', { token: adminToken });
  const adminCityIds = res.data.items.map((r) => r.cityId);
  assert.deepEqual(adminCityIds, [jinanId], `M11 jinan admin byCity returns only jinan: ${JSON.stringify(adminCityIds)}`);
  assert.ok(!adminCityIds.includes(dezhouId), 'M11 jinan admin byCity excludes dezhou (shared contract alloc not leaked)');

  // ============ 2c. 合同额口径一致性：overview?cityId 与 byCity 济南行一致 ============
  res = await api('GET', `/biz/analysis/overview?cityId=${jinanId}`, { token: superToken });
  const overviewJinanAmount = res.data.totalContractAmountFen;
  res = await api('GET', '/biz/analysis/by-city', { token: superToken });
  const jinanByCityAmount = Number(res.data.items.find((r) => r.cityId === jinanId).contractAmountFen);
  assert.equal(overviewJinanAmount, jinanByCityAmount, `M11 contract amount consistent (overview?cityId=${overviewJinanAmount} vs byCity=${jinanByCityAmount})`);
  assert.equal(overviewJinanAmount, 2_900_000_00, 'M11 jinan overview contract amount = 290w (quota-split)');

  // ============ 3a. 提醒实时计算（无显式重算：完工明细已 approve，立即查询） ============
  res = await api('GET', '/biz/analysis/alerts', { token: superToken });
  const alertsNoRecalc = res.data.items;
  assert.ok(alertsNoRecalc.some((a) => a.contractId === c2.data.id && a.alertType === 'expiring'), `M11 expiring without recalc: ${JSON.stringify(alertsNoRecalc.map((a) => [a.contractId, a.alertType]))}`);
  assert.ok(alertsNoRecalc.some((a) => a.contractId === c3.data.id && a.alertType === 'overfull'), 'M11 overfull without recalc (detail-level aggregation)');

  // 重算进汇总（经营金额断言依赖 agg；提醒断言已在上方无重算通过）
  res = await api('POST', '/biz/aggregates/recalc', { token: superToken, body: { scope: {}, confirmAll: true } });
  assert.ok([200, 201].includes(res.status), `M11 recalc: ${JSON.stringify(res.data)}`);

  // ============ 1. 零进度合同计入首页指标 ============
  res = await api('GET', '/biz/analysis/overview', { token: superToken });
  assert.equal(res.data.contractCount, 4, `M11 overview contractCount includes zero-progress C1: ${res.data.contractCount}`);
  assert.equal(res.data.totalContractAmountFen, 3_300_000_00, `M11 overview total contract amount = 50+80+100+100 w: ${res.data.totalContractAmountFen}`);
  assert.equal(res.data.offlineCompletionFen, 1_300_000_00, 'M11 overview offline = C3 120w + C4 10w = 130w');
  assert.equal(res.data.totalCompletionFen, 1_300_000_00, 'M11 overview total completion 130w');

  // ============ 2. 零进度地市也出现在地市表 ============
  res = await api('GET', '/biz/analysis/by-city', { token: superToken });
  const jinanRow = res.data.items.find((r) => r.cityId === jinanId);
  assert.ok(jinanRow, 'M11 byCity includes jinan row (has allocation)');
  assert.equal(Number(jinanRow.contractCount), 4, `M11 jinan contractCount = 4 (all allocated to jinan): ${JSON.stringify(jinanRow)}`);
  // 合同额分摊：C1 50 + C2 80 + C3 100（济南唯一分配）+ C4 60（济南配额 60/100）= 290 万
  assert.equal(Number(jinanRow.contractAmountFen), 2_900_000_00, `M11 jinan contract amount = 290w: ${jinanRow.contractAmountFen}`);
  assert.equal(Number(jinanRow.offlineCompletionFen), 1_300_000_00, 'M11 jinan offline completion 130w');
  // 德州行存在（C4 分配）且零经营
  const dezhouRow = res.data.items.find((r) => r.cityId === dezhouId);
  assert.ok(dezhouRow, 'M11 byCity includes dezhou row (C4 allocation, zero activity)');
  assert.equal(Number(dezhouRow.contractCount), 1, 'M11 dezhou contractCount = 1 (C4)');
  assert.equal(Number(dezhouRow.orderCompletionFen), 0, 'M11 dezhou zero order');
  assert.equal(Number(dezhouRow.offlineCompletionFen), 0, 'M11 dezhou zero offline');

  // ============ 4. 整页筛选作用于超额/提醒 ============
  res = await api('GET', `/biz/analysis/overrun-list?cityId=${jinanId}`, { token: superToken });
  assert.ok(res.data.items.some((o) => o.type === 'city' && o.cityId === jinanId && o.contractId === c3.data.id), `M11 overrun city filter includes jinan C3: ${JSON.stringify(res.data.items)}`);
  res = await api('GET', `/biz/analysis/overrun-list?cityId=${dezhouId}`, { token: superToken });
  assert.equal(res.data.items.filter((o) => o.type === 'city' && o.cityId === dezhouId).length, 0, 'M11 overrun city filter excludes dezhou (no overrun)');
  // 提醒按 cityId 过滤：德州范围不含仅济南的 C3
  res = await api('GET', `/biz/analysis/alerts?cityId=${dezhouId}`, { token: superToken });
  assert.ok(!res.data.items.some((a) => a.contractId === c3.data.id), `M11 alerts city filter excludes jinan-only C3: ${JSON.stringify(res.data.items)}`);
  res = await api('GET', `/biz/analysis/alerts?cityId=${jinanId}`, { token: superToken });
  assert.ok(res.data.items.some((a) => a.contractId === c3.data.id), 'M11 alerts city filter includes C3 for jinan');

  // ============ 5. 共享合同进度口径 ============
  res = await api('GET', `/biz/contracts/${c4.data.id}`, { token: adminToken }); // 济南 city scope
  assert.equal(res.status, 200, 'M11 shared contract visible to jinan admin');
  assert.equal(res.data.progress.progressBasis, 'city-quota', `M11 city progress basis: ${res.data.progress.progressBasis}`);
  assert.equal(res.data.progress.quotaFen, 600_000_00, 'M11 city quota = jinan 60w');
  assert.equal(res.data.progress.totalCompletionFen, 100_000_00, 'M11 city completion only jinan 10w');
  assert.ok(Math.abs(res.data.progress.progress - 16.666666) < 0.01, `M11 city progress = 10w/60w = 16.67%: ${res.data.progress.progress}`);
  assert.equal(res.data.progress.remainingFen, 500_000_00, 'M11 city remaining = 60w - 10w');
  // super 合同整体口径
  res = await api('GET', `/biz/contracts/${c4.data.id}`, { token: superToken });
  assert.equal(res.data.progress.progressBasis, 'contract', 'M11 super progress basis = contract');
  assert.equal(res.data.progress.totalCompletionFen, 100_000_00, 'M11 super completion 10w');
  assert.ok(Math.abs(res.data.progress.progress - 10) < 0.01, 'M11 super progress = 10w/100w = 10%');

  // ============ 5b. 取消分配不稀释进度分母 ============
  const c5 = await api('POST', '/biz/contracts', { token: superToken, body: {
    contractNo: 'HT-M11-CANCEL', contractName: '含取消分配合同', taxInclusiveAmountFen: 2_000_000_00,
    provinceId: shandongId, startDate: '2026-01-01', endDate: endFar,
  } });
  await api('POST', `/biz/contracts/${c5.data.id}/allocations`, { token: superToken, body: { cityId: jinanId, quotaFen: 1_000_000_00 } });
  await api('POST', `/biz/contracts/${c5.data.id}/allocations`, { token: superToken, body: { cityId: dezhouId, quotaFen: 800_000_00 } });
  await api('DELETE', `/biz/contracts/${c5.data.id}/allocations/${dezhouId}`, { token: superToken });
  res = await api('GET', `/biz/contracts/${c5.data.id}`, { token: adminToken }); // 济南 city scope
  assert.equal(res.status, 200, 'M11 C5 visible to jinan admin');
  assert.equal(res.data.progress.progressBasis, 'city-quota', 'M11 C5 city progress basis');
  assert.equal(res.data.progress.quotaFen, 1_000_000_00, `M11 C5 quota excludes cancelled dezhou 80w: ${res.data.progress.quotaFen}`);
  // 地市用户裁剪后只显示本地市（1 条 active）
  assert.equal(res.data.allocations.length, 1, 'M11 C5 jinan admin sees only jinan allocation');
  assert.equal(res.data.allocations.filter((a) => a.status === 'active').length, 1, 'M11 C5 one active allocation');
  // super 全量视角：历史分配保留（济南 active + 德州 cancelled），分母仅 active
  res = await api('GET', `/biz/contracts/${c5.data.id}`, { token: superToken });
  assert.equal(res.data.allocations.length, 2, 'M11 C5 super sees history (2 allocations incl cancelled)');
  assert.equal(res.data.allocations.filter((a) => a.status === 'active').length, 1, 'M11 C5 super sees 1 active');
  assert.equal(res.data.progress.progressBasis, 'contract', 'M11 C5 super contract basis');

  console.log('M11_BUSINESS_OK zero-progress-contract + realtime-alerts(no-recalc) + page-filter + progress-basis + alloc-visibility + quota-split-consistent + cancelled-alloc all passed');
} finally {
  if (apiProcess && apiProcess.exitCode === null) apiProcess.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1000));
  try { rmSync(testRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 }); } catch { console.log('M11_BUSINESS_CLEANUP_WARN'); }
  console.log('M11_BUSINESS_CLEANUP_OK');
}
