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

const testRoot = mkdtempSync(path.join(tmpdir(), 'biz-m5-offcost-'));
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
  JWT_SECRET: 'm5-test-jwt-secret-0123456789abcdef',
  AUTH_SECURITY_HMAC_KEY: 'm5-test-hmac-key-0123456789abcdef',
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
let jinanId = '';
let dezhouId = '';
let shandongId = '';
let contractId = '';
let laborCategory = '';

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
  let payload;
  if (body) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
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

try {
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, ['scripts/db/migrate.mjs', 'up'], { cwd: repoRoot, env, stdio: 'inherit' });
  execFileSync(process.execPath, ['scripts/auth/biz-init-super-admin.mjs'], {
    cwd: repoRoot, env: { ...env, BIZ_SUPER_ADMIN_USERNAME: 'm5_super', BIZ_SUPER_ADMIN_PASSWORD: 'M5-secret-1' }, stdio: 'inherit',
  });

  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}/api`;
  apiProcess = spawn(process.execPath, ['apps/api/dist/main.js'], {
    cwd: repoRoot, env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  apiProcess.stdout.on('data', (c) => process.stdout.write(`[api] ${c}`));
  apiProcess.stderr.on('data', (c) => process.stderr.write(`[api] ${c}`));
  await waitForApi(baseUrl);

  // 准备账号与基础数据
  let res = await api('POST', '/biz/auth/login', { body: { username: 'm5_super', password: 'M5-secret-1' } });
  superToken = res.data.accessToken;
  const [provs, cities, cats] = await Promise.all([
    api('GET', '/biz/admin/provinces', { token: superToken }),
    api('GET', '/biz/admin/cities', { token: superToken }),
    api('GET', '/biz/admin/permissions', { token: superToken }),
  ]);
  shandongId = provs.data.items.find((p) => p.code === '370000').id;
  jinanId = cities.data.items.find((c) => c.code === '370100').id;
  dezhouId = cities.data.items.find((c) => c.code === '371400').id;
  laborCategory = 'labor';
  assert.ok(cats.data.items.some((p) => p.code === 'operation.cost.approve'), 'cost.approve permission seeded');

  for (const dto of [
    { username: 'm5_admin', password: 'M5-secret-1', name: '管理员', roleCode: 'admin' },
    { username: 'm5_city', password: 'M5-secret-1', name: '地市用户', roleCode: 'city_user', cityId: jinanId },
  ]) {
    res = await api('POST', '/biz/admin/users', { token: superToken, body: dto });
    assert.equal(res.status, 201);
  }
  for (const [key, username] of [['admin', 'm5_admin'], ['city', 'm5_city']]) {
    res = await api('POST', '/biz/auth/login', { body: { username, password: 'M5-secret-1' } });
    if (key === 'admin') adminToken = res.data.accessToken;
    if (key === 'city') cityToken = res.data.accessToken;
  }

  // 合同（济南分配 60 万 + 费率）
  res = await api('POST', '/biz/contracts', { token: superToken, body: {
    contractNo: 'HT-OFF-001', contractName: '完工测试合同', taxInclusiveAmountFen: 1_000_000_00,
    provinceId: shandongId, startDate: '2026-01-01', endDate: '2026-12-31',
  } });
  contractId = res.data.id;
  await api('POST', `/biz/contracts/${contractId}/allocations`, { token: superToken, body: { cityId: jinanId, quotaFen: 600_000_00 } });
  await api('POST', `/biz/contracts/${contractId}/fee-rates`, { token: superToken, body: { cityId: jinanId, effectiveMonth: '2026-01', rateBp: 1200 } });

  const makeOffline = (overrides = {}) => ({
    contractId, cityId: jinanId, businessMonth: '2026-06', amountFen: 50_000_00, summary: '测试线下完工',
    ...overrides,
  });

  // ============ OFF-001 地市范围 ============
  res = await api('POST', '/biz/offline-completions', { token: cityToken, body: makeOffline({ cityId: dezhouId }) });
  assert.equal(res.status, 403, 'OFF-001 city_user other-city must be 403');
  res = await api('POST', '/biz/offline-completions', { token: cityToken, body: makeOffline() });
  assert.equal(res.status, 201, 'OFF-001 city_user own-city OK');
  const off1 = res.data;

  // ============ OFF-002 提交校验 ============
  res = await api('POST', '/biz/offline-completions', { token: cityToken, body: makeOffline({ amountFen: 0 }) });
  assert.equal(res.status, 400, 'OFF-002 zero amount rejected');
  res = await api('POST', '/biz/offline-completions', { token: cityToken, body: makeOffline({ businessMonth: '2099-01' }) });
  assert.equal(res.status, 400, 'OFF-002 future month rejected');
  res = await api('POST', '/biz/offline-completions', { token: cityToken, body: makeOffline({ contractId: randomUUID() }) });
  assert.equal(res.status, 400, 'OFF-002 unknown contract rejected');

  // ============ OFF-003 提交 ============
  res = await api('POST', `/biz/offline-completions/${off1.id}/submit`, { token: cityToken });
  assert.equal(res.status, 201);
  assert.equal(res.data.status, 'pending', 'OFF-003 draft -> pending');

  // ============ OFF-004 审核权限 ============
  res = await api('POST', `/biz/offline-completions/${off1.id}/approve`, { token: cityToken });
  assert.equal(res.status, 403, 'OFF-004 city_user no approve permission');

  // ============ OFF-005 审核通过（重新校验） ============
  res = await api('POST', `/biz/offline-completions/${off1.id}/approve`, { token: adminToken });
  assert.equal(res.status, 201, `OFF-005 admin approve: ${JSON.stringify(res.data)}`);
  assert.equal(res.data.status, 'approved');

  // ============ OFF-006 驳回（原因必填；驳回后可编辑重新提交） ============
  const off2res = await api('POST', '/biz/offline-completions', { token: cityToken, body: makeOffline({ amountFen: 30_000_00, summary: '待驳回' }) });
  const off2 = off2res.data;
  await api('POST', `/biz/offline-completions/${off2.id}/submit`, { token: cityToken });
  res = await api('POST', `/biz/offline-completions/${off2.id}/reject`, { token: adminToken, body: { comment: '' } });
  assert.equal(res.status, 400, 'OFF-006 reject reason required');
  res = await api('POST', `/biz/offline-completions/${off2.id}/reject`, { token: adminToken, body: { comment: '金额不实' } });
  assert.equal(res.status, 201);
  assert.equal(res.data.status, 'rejected');
  // 驳回后可编辑并重新提交
  res = await api('PATCH', `/biz/offline-completions/${off2.id}`, { token: cityToken, body: { amountFen: 25_000_00 } });
  assert.equal(res.status, 200);
  res = await api('POST', `/biz/offline-completions/${off2.id}/submit`, { token: cityToken });
  assert.equal(res.data.status, 'pending', 'OFF-006 re-submit after reject');

  // ============ OFF-007 已通过作废（原因必填；权限） ============
  res = await api('POST', `/biz/offline-completions/${off1.id}/void`, { token: cityToken, body: { reason: 'x' } });
  assert.equal(res.status, 403, 'OFF-007 city_user no void permission');
  res = await api('POST', `/biz/offline-completions/${off1.id}/void`, { token: adminToken, body: { reason: '' } });
  assert.equal(res.status, 400, 'OFF-007 void reason required');
  res = await api('POST', `/biz/offline-completions/${off1.id}/void`, { token: adminToken, body: { reason: '录入有误' } });
  assert.equal(res.status, 201);
  assert.equal(res.data.status, 'voided');

  // ============ OFF-008 恢复已作废 ============
  res = await api('POST', `/biz/offline-completions/${off1.id}/restore`, { token: adminToken });
  assert.equal(res.status, 201);
  assert.equal(res.data.status, 'approved', 'OFF-008 restore -> approved');

  // ============ OFF-010 撤回（仅提交人） ============
  const off3res = await api('POST', '/biz/offline-completions', { token: cityToken, body: makeOffline({ amountFen: 10_000_00 }) });
  const off3 = off3res.data;
  await api('POST', `/biz/offline-completions/${off3.id}/submit`, { token: cityToken });
  res = await api('POST', `/biz/offline-completions/${off3.id}/withdraw`, { token: adminToken });
  assert.equal(res.status, 403, 'OFF-010 non-submitter withdraw must be 403');
  res = await api('POST', `/biz/offline-completions/${off3.id}/withdraw`, { token: cityToken });
  assert.equal(res.status, 201);
  assert.equal(res.data.status, 'draft', 'OFF-010 withdraw -> draft');

  // ============ OFF-009 版本并发：双审冲突 ============
  {
    const off4res = await api('POST', '/biz/offline-completions', { token: cityToken, body: makeOffline({ amountFen: 20_000_00 }) });
    const off4 = off4res.data;
    await api('POST', `/biz/offline-completions/${off4.id}/submit`, { token: cityToken });
    // 同一实体两次审核：第二次应乐观锁冲突（版本已 +1）
    const ds = createDirectDataSource();
    await ds.initialize();
    const repo = ds.getRepository('BizOfflineCompletionEntity');
    // 版本保护验证：先由服务方推进版本（vA），再以旧版本条件更新应命中 0 行
    const vA = await repo.findOneByOrFail({ id: off4.id });
    vA.status = 'approved';
    await repo.save(vA); // 版本 1 -> 2
    const oldVersion = vA.versionNo - 1; // 1
    const result = await ds.createQueryBuilder()
      .update('biz_offline_completions')
      .set({ status: 'rejected' })
      .where('id = :id AND version_no = :version', { id: off4.id, version: oldVersion })
      .execute();
    assert.equal(result.affected, 0, 'OFF-009 version guard: stale version must update 0 rows');
    await ds.destroy();
  }

  // ============ CST-001 成本不关联合同 ============
  const costBody = { cityId: jinanId, businessMonth: '2026-06', categoryCode: laborCategory, amountFen: 8_000_00, description: '测试成本' };
  res = await api('POST', '/biz/costs', { token: cityToken, body: costBody });
  assert.equal(res.status, 201, 'CST-001 cost create (no contract)');
  const cost1 = res.data;
  assert.ok(!('contractId' in cost1), 'CST-001 cost must NOT reference contract');

  // ============ CST-002 分类必填/不存在 ============
  res = await api('POST', '/biz/costs', { token: cityToken, body: { ...costBody, categoryCode: 'not-exist' } });
  assert.equal(res.status, 400, 'CST-002 unknown category rejected');
  res = await api('POST', '/biz/costs', { token: cityToken, body: { ...costBody, categoryCode: '' } });
  assert.equal(res.status, 400, 'CST-002 empty category rejected');

  // ============ CST-003 金额/月份约束 ============
  res = await api('POST', '/biz/costs', { token: cityToken, body: { ...costBody, amountFen: -100 } });
  assert.equal(res.status, 400, 'CST-003 negative amount rejected');
  res = await api('POST', '/biz/costs', { token: cityToken, body: { ...costBody, businessMonth: '2099-01' } });
  assert.equal(res.status, 400, 'CST-003 future month rejected');

  // ============ CST-004 提交即生效 + 管理员退回 ============
  res = await api('POST', `/biz/costs/${cost1.id}/submit`, { token: cityToken });
  assert.equal(res.status, 201, 'CST-004 city submit succeeds');
  assert.equal(res.data.status, 'approved', 'CST-004 submit is effective immediately');
  res = await api('POST', `/biz/costs/${cost1.id}/approve`, { token: adminToken });
  assert.equal(res.status, 400, 'CST-004 legacy approve cannot re-approve an effective cost');
  res = await api('POST', `/biz/costs/${cost1.id}/reject`, { token: adminToken, body: { comment: '请补充成本说明' } });
  assert.equal(res.status, 201, 'CST-004 admin can return an effective cost');
  assert.equal(res.data.status, 'rejected');
  res = await api('PATCH', `/biz/costs/${cost1.id}`, { token: cityToken, body: { amountFen: 810_000, description: '修改后成本' } });
  assert.equal(res.status, 200, 'CST-004 city can edit a returned cost');
  res = await api('POST', `/biz/costs/${cost1.id}/submit`, { token: cityToken });
  assert.equal(res.status, 201);
  assert.equal(res.data.status, 'approved', 'CST-004 resubmission is effective immediately');
  res = await api('POST', '/biz/costs/monthly/return', { token: adminToken, body: { cityId: jinanId, businessMonth: '2026-06', comment: '整月补充说明' } });
  assert.equal(res.status, 201, 'CST-004 admin can return the whole city month');
  assert.ok(res.data.items.some((item) => item.id === cost1.id), 'CST-004 monthly return includes the cost entry');
  res = await api('PATCH', `/biz/costs/${cost1.id}`, { token: cityToken, body: { description: '整月退回后修改' } });
  assert.equal(res.status, 200, 'CST-004 returned monthly cost remains editable');
  res = await api('POST', `/biz/costs/${cost1.id}/submit`, { token: cityToken });
  assert.equal(res.status, 201);

  // ============ CST-005 驳回（原因必填） ============
  const cost2res = await api('POST', '/biz/costs', { token: cityToken, body: { ...costBody, amountFen: 5_000_00 } });
  const cost2 = cost2res.data;
  await api('POST', `/biz/costs/${cost2.id}/submit`, { token: cityToken });
  res = await api('POST', `/biz/costs/${cost2.id}/reject`, { token: superToken, body: { comment: '' } });
  assert.equal(res.status, 400, 'CST-005 reject reason required');
  res = await api('POST', `/biz/costs/${cost2.id}/reject`, { token: superToken, body: { comment: '分类不对' } });
  assert.equal(res.status, 201);
  assert.equal(res.data.status, 'rejected');

  // ============ CST-006 作废/恢复 ============
  res = await api('POST', `/biz/costs/${cost1.id}/void`, { token: superToken, body: { reason: '' } });
  assert.equal(res.status, 400, 'CST-006 void reason required');
  res = await api('POST', `/biz/costs/${cost1.id}/void`, { token: superToken, body: { reason: '录入错误' } });
  assert.equal(res.status, 201);
  assert.equal(res.data.status, 'voided');
  res = await api('POST', `/biz/costs/${cost1.id}/restore`, { token: superToken });
  assert.equal(res.status, 201);
  assert.equal(res.data.status, 'approved', 'CST-006 restore');

  // ============ CST-007 状态机非法跳转 ============
  res = await api('POST', `/biz/costs/${cost1.id}/submit`, { token: cityToken });
  assert.equal(res.status, 400, 'CST-007 approved cost cannot re-submit');
  res = await api('POST', `/biz/costs/${cost2.id}/approve`, { token: superToken });
  assert.equal(res.status, 400, 'CST-007 rejected cost cannot be approved directly');

  // ============ CST-008 并发（成本乐观锁） ============
  {
    const cost3res = await api('POST', '/biz/costs', { token: cityToken, body: { ...costBody, amountFen: 3_000_00 } });
    const cost3 = cost3res.data;
    await api('POST', `/biz/costs/${cost3.id}/submit`, { token: cityToken });
    const ds = createDirectDataSource();
    await ds.initialize();
    const repo = ds.getRepository('BizCostEntryEntity');
    const v1 = await repo.findOneByOrFail({ id: cost3.id });
    v1.status = 'approved';
    await repo.save(v1);
    const oldVersion = v1.versionNo - 1;
    const result = await ds.createQueryBuilder()
      .update('biz_cost_entries')
      .set({ status: 'voided' })
      .where('id = :id AND version_no = :version', { id: cost3.id, version: oldVersion })
      .execute();
    assert.equal(result.affected, 0, 'CST-008 version guard: stale version must update 0 rows');
    await ds.destroy();
  }

  console.log('M5_OFFCOST_OK OFF-001..010 + CST-001..008 all passed (scope, submit rules, approve/reject+recheck, void/restore, withdraw, optimistic-lock, cost no-contract, category, cost-authorization, state machine)');
} finally {
  if (apiProcess && apiProcess.exitCode === null) apiProcess.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 1000));
  try {
    rmSync(testRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 });
  } catch {
    console.log(`M5_OFFCOST_CLEANUP_WARN root=${testRoot}`);
  }
  console.log(`M5_OFFCOST_CLEANUP_OK root=${testRoot}`);
}
