import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const apiRoot = path.join(repoRoot, 'apps', 'api');
const requireFromApi = createRequire(path.join(apiRoot, 'package.json'));
const { DataSource } = requireFromApi('typeorm');

const testRoot = mkdtempSync(path.join(tmpdir(), 'biz-m3-contract-'));
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
  JWT_SECRET: 'm3-test-jwt-secret-0123456789abcdef',
  AUTH_SECURITY_HMAC_KEY: 'm3-test-hmac-key-0123456789abcdef',
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

let apiProcess;
let baseUrl = '';
let superToken = '';
let adminToken = '';
let cityToken = '';
let managerToken = '';
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
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  const text = await res.text();
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
    cwd: repoRoot,
    env: { ...env, BIZ_SUPER_ADMIN_USERNAME: 'm3_super', BIZ_SUPER_ADMIN_PASSWORD: 'M3-secret-1' },
    stdio: 'inherit',
  });

  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}/api`;
  apiProcess = spawn(process.execPath, ['apps/api/dist/main.js'], {
    cwd: repoRoot, env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  apiProcess.stdout.on('data', (c) => process.stdout.write(`[api] ${c}`));
  apiProcess.stderr.on('data', (c) => process.stderr.write(`[api] ${c}`));
  await waitForApi(baseUrl);

  // 登录 super_admin + 创建 admin/contract_manager/city_user
  let res = await api('POST', '/biz/auth/login', { body: { username: 'm3_super', password: 'M3-secret-1' } });
  superToken = res.data.accessToken;

  const [provincesRes, citiesRes] = await Promise.all([
    api('GET', '/biz/admin/provinces', { token: superToken }),
    api('GET', '/biz/admin/cities', { token: superToken }),
  ]);
  shandongId = provincesRes.data.items.find((p) => p.code === '370000').id;
  jinanId = citiesRes.data.items.find((c) => c.code === '370100').id;
  dezhouId = citiesRes.data.items.find((c) => c.code === '371400').id;

  for (const dto of [
    { username: 'm3_admin', password: 'M3-secret-1', name: '管理员', roleCode: 'admin' },
    { username: 'm3_manager', password: 'M3-secret-1', name: '合同管理员', roleCode: 'contract_manager' },
    { username: 'm3_city', password: 'M3-secret-1', name: '地市用户', roleCode: 'city_user', cityId: jinanId },
  ]) {
    res = await api('POST', '/biz/admin/users', { token: superToken, body: dto });
    assert.equal(res.status, 201, `create user failed: ${JSON.stringify(res.data)}`);
  }
  for (const [key, username] of [['admin', 'm3_admin'], ['city', 'm3_city'], ['manager', 'm3_manager']]) {
    res = await api('POST', '/biz/auth/login', { body: { username, password: 'M3-secret-1' } });
    if (key === 'admin') adminToken = res.data.accessToken;
    if (key === 'city') cityToken = res.data.accessToken;
    if (key === 'manager') managerToken = res.data.accessToken;
  }

  // ============ CON-001 合同号唯一 ============
  res = await api('POST', '/biz/contracts', { token: superToken, body: {
    contractNo: 'HT-CON-001', contractName: '测试合同A', taxInclusiveAmountFen: 1_000_000_00, provinceId: shandongId,
  } });
  assert.equal(res.status, 201, `create contract A failed: ${JSON.stringify(res.data)}`);
  const contractA = res.data;
  res = await api('POST', '/biz/contracts', { token: superToken, body: {
    contractNo: 'HT-CON-001', contractName: '重复合同号', taxInclusiveAmountFen: 100, provinceId: shandongId,
  } });
  assert.equal(res.status, 400, 'CON-001 duplicate contract_no must be rejected');

  // ============ CON-002 不完整草稿 ============
  res = await api('POST', '/biz/contracts', { token: superToken, body: {
    contractNo: 'HT-CON-002', contractName: '不完整合同', taxInclusiveAmountFen: 0, provinceId: shandongId,
  } });
  assert.equal(res.status, 201, 'incomplete draft may be saved');
  const draftId = res.data.id;
  res = await api('POST', `/biz/contracts/${draftId}/activate`, { token: superToken });
  assert.equal(res.status, 400, 'CON-002 incomplete contract must NOT activate');

  // 补全并分配费率
  await api('PATCH', `/biz/contracts/${draftId}`, { token: superToken, body: {
    taxInclusiveAmountFen: 500_000_00, startDate: '2026-01-01', endDate: '2026-12-31',
  } });
  await api('POST', `/biz/contracts/${draftId}/allocations`, { token: superToken, body: { cityId: jinanId, quotaFen: 500_000_00 } });
  await api('POST', `/biz/contracts/${draftId}/fee-rates`, { token: superToken, body: { cityId: jinanId, effectiveMonth: '2026-01', rateBp: 1000 } });

  // ============ CON-003 合同额锁定 ============
  res = await api('POST', `/biz/contracts/${draftId}/activate`, { token: superToken });
  assert.equal(res.status, 201, `activate should succeed: ${JSON.stringify(res.data)}`);
  assert.equal(res.data.amountLocked, true, 'activated contract must lock amount');
  res = await api('PATCH', `/biz/contracts/${draftId}`, { token: superToken, body: { taxInclusiveAmountFen: 999 } });
  assert.equal(res.status, 400, 'CON-003 locked amount must NOT be editable');

  // ============ CON-004 错误合同处理：作废 + 重建 ============
  res = await api('POST', `/biz/contracts/${draftId}/void`, { token: superToken, body: { summaryChoice: 'exclude_current', reason: '录错测试' } });
  assert.equal(res.status, 201, 'void should succeed');
  assert.equal(res.data.status, 'voided');
  res = await api('POST', `/biz/contracts/${draftId}/void`, { token: superToken, body: { summaryChoice: 'exclude_current', reason: 'again' } });
  assert.equal(res.status, 400, 'STA-001 void a voided contract must be rejected');
  // 重建（新合同号）
  res = await api('POST', '/biz/contracts', { token: superToken, body: {
    contractNo: 'HT-CON-004', contractName: '重建合同', taxInclusiveAmountFen: 800_000_00, provinceId: shandongId,
  } });
  assert.equal(res.status, 201, 'recreate with new contract_no');

  // ============ CON-005 补充合同（父合同） ============
  res = await api('POST', '/biz/contracts', { token: superToken, body: {
    contractNo: 'HT-CON-005', contractName: '补充合同', taxInclusiveAmountFen: 200_000_00, provinceId: shandongId,
    parentContractId: contractA.id,
  } });
  assert.equal(res.status, 201, 'supplement contract with parent');
  assert.equal(res.data.parentContractId, contractA.id);

  // ============ CON-006 地市额度合计 ≤ 合同额 ============
  await api('POST', `/biz/contracts/${contractA.id}/allocations`, { token: superToken, body: { cityId: jinanId, quotaFen: 600_000_00 } });
  res = await api('POST', `/biz/contracts/${contractA.id}/allocations`, { token: superToken, body: { cityId: dezhouId, quotaFen: 400_000_00 } });
  assert.equal(res.status, 201, 'allocations 600k+400k = 1000k <= 1000k OK');
  res = await api('POST', `/biz/contracts/${contractA.id}/allocations`, { token: superToken, body: { cityId: jinanId, quotaFen: 700_000_00 } });
  assert.equal(res.status, 400, 'CON-006 quota total exceeding contract amount must be rejected');
  // 分配后补费率（济南 10% 2026-01 起；德州 8% 2026-01 起）
  await api('POST', `/biz/contracts/${contractA.id}/fee-rates`, { token: superToken, body: { cityId: jinanId, effectiveMonth: '2026-01', rateBp: 1000 } });
  await api('POST', `/biz/contracts/${contractA.id}/fee-rates`, { token: superToken, body: { cityId: dezhouId, effectiveMonth: '2026-01', rateBp: 800 } });

  // ============ CON-007 降低额度（合法范围内允许） ============
  res = await api('POST', `/biz/contracts/${contractA.id}/allocations`, { token: superToken, body: { cityId: jinanId, quotaFen: 500_000_00 } });
  assert.equal(res.status, 201, 'CON-007 lower quota within limit OK');

  // ============ CON-008 取消分配：city_user 403 / admin 200（019 授权 admin）/ super 200 ============
  res = await api('DELETE', `/biz/contracts/${contractA.id}/allocations/${dezhouId}`, { token: cityToken });
  assert.equal(res.status, 403, 'CON-008 city_user must NOT cancel allocation (403)');
  res = await api('DELETE', `/biz/contracts/${contractA.id}/allocations/${dezhouId}`, { token: adminToken });
  assert.equal(res.status, 200, 'CON-008 admin cancels allocation OK (019 grants allocate_cancel)');
  // 取消为软取消（保留历史行）；改用另一地市重新分配后再由 super 取消（验证 super 通配）
  res = await api('GET', '/biz/admin/cities', { token: superToken });
  const qingdaoId = res.data.items.find((c) => c.code === '370200').id;
  await api('POST', `/biz/contracts/${contractA.id}/allocations`, { token: superToken, body: { cityId: qingdaoId, quotaFen: 100_000_00 } });
  res = await api('DELETE', `/biz/contracts/${contractA.id}/allocations/${qingdaoId}`, { token: superToken });
  assert.equal(res.status, 200, 'super_admin cancels allocation OK');

  // ============ CON-009 超额真实入账：直接插入订单行，detail 进度 >100% ============
  {
    const ds = createDirectDataSource();
    await ds.initialize();
    const rowRepo = ds.getRepository('BizOrderRowEntity');
    // 合同A 已分配 500k（济南），合同额 1000k。先插入 600k 订单（超过地市额度但未超合同额）
    await rowRepo.save({ id: randomUUID(), batchId: randomUUID(), sourceRowNo: 1, cityId: jinanId, contractId: contractA.id,
      businessMonth: '2026-03', completionAmountFen: 600_000_00, feeRateSnapshotBp: 1000, grossProfitFen: 60_000_00,
      isVoid: false, cityOverrunFlag: false, contractOverrunFlag: false });
    await ds.destroy();

    res = await api('GET', `/biz/contracts/${contractA.id}`, { token: superToken });
    assert.equal(res.status, 200);
    assert.equal(res.data.progress.totalCompletionFen, 600_000_00);
    assert.equal(res.data.progress.progress, 60, 'progress 60%');
    const jinanRow = res.data.allocations.find((a) => a.cityId === jinanId);
    assert.equal(jinanRow.completionFen, 600_000_00);
    assert.equal(jinanRow.overrunFen, 100_000_00, 'city overrun 100k');
    assert.equal(res.data.progress.overrunFen, 0, 'contract not overrun yet');
  }

  // 再插入 600k → 合同累计 1200k > 1000k → 进度 120% + 合同超额 200k
  {
    const ds = createDirectDataSource();
    await ds.initialize();
    const rowRepo = ds.getRepository('BizOrderRowEntity');
    await rowRepo.save({ id: randomUUID(), batchId: randomUUID(), sourceRowNo: 2, cityId: jinanId, contractId: contractA.id,
      businessMonth: '2026-04', completionAmountFen: 600_000_00, feeRateSnapshotBp: 1000, grossProfitFen: 60_000_00,
      isVoid: false, cityOverrunFlag: false, contractOverrunFlag: false });
    await ds.destroy();

    res = await api('GET', `/biz/contracts/${contractA.id}`, { token: superToken });
    assert.equal(res.data.progress.progress, 120, 'CON-009 progress may exceed 100%');
    assert.equal(res.data.progress.overrunFen, 200_000_00, 'contract overrun 200k');
    assert.equal(res.data.progress.remainingFen, -200_000_00, 'remaining negative = overrun');
  }

  // ============ CON-010 详情聚合完整结构 ============
  res = await api('GET', `/biz/contracts/${contractA.id}`, { token: adminToken });
  assert.equal(res.status, 200);
  assert.ok(res.data.contract.id && res.data.contract.contractNo === 'HT-CON-001');
  assert.ok(Array.isArray(res.data.allocations) && Array.isArray(res.data.feeRates) && Array.isArray(res.data.alerts));
  assert.ok('progress' in res.data && 'overrunFen' in res.data.progress);
  assert.equal(res.data.contract.taxInclusiveAmountFen, 1_000_000_00, 'integer fen amount');

  // ============ 费率快照（生效历史） ============
  res = await api('GET', `/biz/contracts/${contractA.id}/effective-rate?cityId=${jinanId}&month=2026-02`, { token: superToken });
  assert.equal(res.data.rate.rateBp, 1000, '2026-02 uses 2026-01 rate 10%');
  await api('POST', `/biz/contracts/${contractA.id}/fee-rates`, { token: superToken, body: { cityId: jinanId, effectiveMonth: '2026-05', rateBp: 1200, changeReason: '费率调整测试' } });
  res = await api('GET', `/biz/contracts/${contractA.id}/effective-rate?cityId=${jinanId}&month=2026-04`, { token: superToken });
  assert.equal(res.data.rate.rateBp, 1000, '2026-04 still uses 10% (history not recomputed)');
  res = await api('GET', `/biz/contracts/${contractA.id}/effective-rate?cityId=${jinanId}&month=2026-05`, { token: superToken });
  assert.equal(res.data.rate.rateBp, 1200, '2026-05 uses new 12% rate');
  res = await api('POST', `/biz/contracts/${contractA.id}/fee-rates`, { token: superToken, body: { cityId: jinanId, effectiveMonth: '2026-05', rateBp: 1100 } });
  assert.equal(res.status, 400, 'duplicate (contract,city,month) rate rejected');

  // ============ 权限：contract_manager 可建合同；city_user 仅已分配本地市 ============
  // 合同A 已分配济南（500k）→ city_user（济南）可见
  res = await api('GET', '/biz/contracts', { token: cityToken });
  assert.equal(res.status, 200);
  assert.ok(res.data.items.some((c) => c.id === contractA.id), 'city_user sees jinan-allocated contract A');
  // 创建只分配德州的合同 → city_user（济南）不可见
  const dezhouOnly = await api('POST', '/biz/contracts', { token: superToken, body: {
    contractNo: 'HT-CON-DZ', contractName: '德州专属合同', taxInclusiveAmountFen: 300_000_00, provinceId: shandongId,
  } });
  await api('POST', `/biz/contracts/${dezhouOnly.data.id}/allocations`, { token: superToken, body: { cityId: dezhouId, quotaFen: 300_000_00 } });
  res = await api('GET', '/biz/contracts', { token: cityToken });
  assert.ok(!res.data.items.some((c) => c.id === dezhouOnly.data.id), 'city_user must NOT see dezhou-only contract');
  // contract_manager 无订单权限（合同只读+维护）：GET 合同列表 OK
  res = await api('GET', '/biz/contracts', { token: managerToken });
  assert.equal(res.status, 200, 'contract_manager can list contracts');

  // ============ CON-011 软删除/批量操作（delete/restore/batch-delete/batch-update/batch-restore/export） ============
  // 新建 2 份草稿用于批量测试
  const sdA = await api('POST', '/biz/contracts', { token: superToken, body: {
    contractNo: 'HT-CON-SD-A', contractName: '软删A', taxInclusiveAmountFen: 100_000_00, provinceId: shandongId,
  } });
  const sdB = await api('POST', '/biz/contracts', { token: superToken, body: {
    contractNo: 'HT-CON-SD-B', contractName: '软删B', taxInclusiveAmountFen: 100_000_00, provinceId: shandongId,
  } });
  assert.equal(sdA.status, 201, 'CON-011 create A');
  assert.equal(sdB.status, 201, 'CON-011 create B');
  // 单条删除：city_user 403；admin 200（021 已授权 admin）
  res = await api('DELETE', `/biz/contracts/${sdA.data.id}`, { token: cityToken });
  assert.equal(res.status, 403, 'CON-011 city_user cannot delete contract');
  res = await api('DELETE', `/biz/contracts/${sdA.data.id}`, { token: adminToken });
  assert.equal(res.status, 200, 'CON-011 admin soft-delete OK');
  // list 默认不含已删除；includeDeleted=true 包含且带 deletedAt
  res = await api('GET', '/biz/contracts', { token: adminToken });
  assert.ok(!res.data.items.some((c) => c.id === sdA.data.id), 'CON-011 default list excludes deleted');
  res = await api('GET', '/biz/contracts?includeDeleted=true', { token: adminToken });
  const deletedRow = res.data.items.find((c) => c.id === sdA.data.id);
  assert.ok(deletedRow && deletedRow.deletedAt, 'CON-011 includeDeleted shows deletedAt');
  // 单条恢复
  res = await api('POST', `/biz/contracts/${sdA.data.id}/restore`, { token: adminToken });
  assert.equal(res.status, 201, 'CON-011 single restore OK');
  // 批量删除（2 份）→ checked=2 deleted=2 skipped=0
  res = await api('POST', '/biz/contracts/batch-delete', { token: adminToken, body: { ids: [sdA.data.id, sdB.data.id] } });
  assert.equal(res.status, 201, 'CON-011 batch-delete status');
  assert.equal(res.data.checked, 2, 'CON-011 batch-delete checked=2');
  assert.equal(res.data.deleted.length, 2, 'CON-011 batch-delete all');
  assert.equal(res.data.skipped.length, 0, 'CON-011 batch-delete no skip');
  // 重复删除 → skipped 已删除（失败原因逐条返回）
  res = await api('POST', '/biz/contracts/batch-delete', { token: adminToken, body: { ids: [sdA.data.id] } });
  assert.equal(res.data.skipped.length, 1, 'CON-011 re-delete skipped with reason');
  // 批量恢复
  res = await api('POST', '/biz/contracts/batch-restore', { token: adminToken, body: { ids: [sdA.data.id, sdB.data.id] } });
  assert.equal(res.status, 201, 'CON-011 batch-restore status');
  assert.equal(res.data.restored.length, 2, 'CON-011 batch-restore all');
  // 批量修改（改名+金额）
  res = await api('POST', '/biz/contracts/batch-update', { token: adminToken, body: { ids: [sdA.data.id, sdB.data.id], dto: { contractName: '批量改名', taxInclusiveAmountFen: 200_000_00 } } });
  assert.equal(res.status, 201, 'CON-011 batch-update status');
  assert.equal(res.data.updated.length, 2, 'CON-011 batch-update all');
  res = await api('GET', '/biz/contracts', { token: adminToken });
  const renamed = res.data.items.filter((c) => [sdA.data.id, sdB.data.id].includes(c.id));
  assert.ok(renamed.length === 2 && renamed.every((c) => c.contractName === '批量改名' && Number(c.taxInclusiveAmountFen) === 200_000_00), 'CON-011 batch-update applied');
  // 导出：ids + includeDeleted 包含已删除行（先删一份再导出）
  await api('DELETE', `/biz/contracts/${sdA.data.id}`, { token: adminToken });
  res = await api('GET', `/biz/contracts/export?ids=${sdA.data.id},${sdB.data.id}&includeDeleted=true`, { token: adminToken });
  assert.equal(res.status, 200, 'CON-011 export status');
  assert.ok(typeof res.data === 'string' && res.data.includes('HT-CON-SD-A') && res.data.includes('已删除'), 'CON-011 export csv includes deleted row');
  assert.ok(res.data.includes('HT-CON-SD-B'), 'CON-011 export csv includes normal row');
  // 数据范围：city_user 有 export 权限（012 种子），但只能导出可见合同（无分配的地市不可见）
  res = await api('GET', `/biz/contracts/export?ids=${sdA.data.id}`, { token: cityToken });
  assert.equal(res.status, 200, 'CON-011 city_user export allowed (012 grants export)');
  assert.ok(typeof res.data === 'string' && !res.data.includes('HT-CON-SD-A'), 'CON-011 city_user export excludes non-visible contract');

  console.log('M3_CONTRACTS_OK CON-001..011 all passed, STA-001 void-void rejected, quota-sum rejected, super-only cancel, effective-rate history, city scope, overrun>100%, soft-delete/batch ops');
} finally {
  if (apiProcess && apiProcess.exitCode === null) apiProcess.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 500));
  rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  console.log(`M3_CONTRACTS_CLEANUP_OK root=${testRoot}`);
}
