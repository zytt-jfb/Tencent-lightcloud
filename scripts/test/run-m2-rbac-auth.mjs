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

const testRoot = mkdtempSync(path.join(tmpdir(), 'biz-m2-rbac-'));
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
  JWT_SECRET: 'm2-test-jwt-secret-0123456789abcdef',
  AUTH_SECURITY_HMAC_KEY: 'm2-test-hmac-key-0123456789abcdef',
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

const SUPER_ADMIN_USER = 'm2_super';
const SUPER_ADMIN_PASS = 'M2-secret-1';
const BIZ_SUPER_ADMIN_USERNAME = SUPER_ADMIN_USER;
const BIZ_SUPER_ADMIN_PASSWORD = SUPER_ADMIN_PASS;

let apiProcess;
let baseUrl = '';
let superToken = '';

async function waitForApi(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/biz/auth/me`);
      // me 未带 token 返回 401 即可视为服务已就绪
      if (res.status === 401 || res.status === 200) return;
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('API did not become ready');
}

async function api(method, urlPath, { token, body } = {}) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
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
  // 1. 空库执行 001-013 迁移
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, ['scripts/db/migrate.mjs', 'up'], { cwd: repoRoot, env, stdio: 'inherit' });

  // 2. 初始化 super_admin
  execFileSync(process.execPath, ['scripts/auth/biz-init-super-admin.mjs'], {
    cwd: repoRoot, env: { ...env, BIZ_SUPER_ADMIN_USERNAME, BIZ_SUPER_ADMIN_PASSWORD }, stdio: 'inherit',
  });

  // 3. 启动 API
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}/api`;
  apiProcess = spawn(process.execPath, ['apps/api/dist/main.js'], {
    cwd: repoRoot,
    env: { ...env, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  apiProcess.stdout.on('data', (c) => process.stdout.write(`[api] ${c}`));
  apiProcess.stderr.on('data', (c) => process.stderr.write(`[api] ${c}`));
  await waitForApi(baseUrl);

  // ============ 4. super_admin 登录 ============
  let res = await api('POST', '/biz/auth/login', { body: { username: SUPER_ADMIN_USER, password: SUPER_ADMIN_PASS } });
  assert.equal(res.status, 201, `super login should succeed, got ${res.status}`);
  superToken = res.data.accessToken;
  assert.ok(superToken, 'super token missing');

  // me：super_admin 通配权限
  res = await api('GET', '/biz/auth/me', { token: superToken });
  assert.equal(res.status, 200);
  assert.equal(res.data.roleCode, 'super_admin');
  assert.deepEqual(res.data.permissions, ['*'], 'super_admin should have wildcard permission');
  assert.equal(res.data.dataScope.scopeType, 'all');

  // 门户：super_admin 看到全部 5 个模块
  res = await api('GET', '/biz/portal/modules', { token: superToken });
  assert.equal(res.status, 200);
  assert.equal(res.data.level1.length, 2, 'super sees 2 level1 modules');
  assert.equal(res.data.level2.length, 3, 'super sees 3 level2 modules');

  // 权限管理字典
  res = await api('GET', '/biz/admin/roles', { token: superToken });
  assert.equal(res.status, 200);
  assert.equal(res.data.items.length, 4);

  // ============ 5. 创建 admin / contract_manager / city_user ============
  const [provincesRes, citiesRes] = await Promise.all([
    api('GET', '/biz/admin/provinces', { token: superToken }),
    api('GET', '/biz/admin/cities', { token: superToken }),
  ]);
  const shandong = provincesRes.data.items.find((p) => p.code === '370000');
  const jinan = citiesRes.data.items.find((c) => c.code === '370100');
  assert.ok(shandong && jinan, 'seed province/city missing');

  const created = {};
  for (const [key, dto] of Object.entries({
    admin: { username: 'm2_admin', password: 'M2-secret-1', name: '测试管理员', roleCode: 'admin' },
    manager: { username: 'm2_manager', password: 'M2-secret-1', name: '测试合同管理员', roleCode: 'contract_manager' },
    city: { username: 'm2_city', password: 'M2-secret-1', name: '测试地市用户', roleCode: 'city_user', cityId: jinan.id },
  })) {
    res = await api('POST', '/biz/admin/users', { token: superToken, body: dto });
    assert.equal(res.status, 201, `create ${key} failed: ${res.status} ${JSON.stringify(res.data)}`);
    created[key] = res.data;
  }

  // ============ 6. 四角色权限断言 ============
  const loginTokens = {};
  for (const [key, dto] of Object.entries({
    admin: { username: 'm2_admin', password: 'M2-secret-1' },
    manager: { username: 'm2_manager', password: 'M2-secret-1' },
    city: { username: 'm2_city', password: 'M2-secret-1' },
  })) {
    res = await api('POST', '/biz/auth/login', { body: dto });
    assert.equal(res.status, 201, `${key} login failed`);
    loginTokens[key] = res.data.accessToken;
  }

  // admin：一级门户含 engineering + maintenance；可访问经营管理；无用户管理权限
  res = await api('GET', '/biz/portal/modules', { token: loginTokens.admin });
  assert.ok(res.data.level1.some((m) => m.code === 'engineering'), 'admin should see engineering');
  assert.ok(res.data.level1.some((m) => m.code === 'maintenance'), 'admin should see maintenance');
  res = await api('GET', '/biz/admin/users', { token: loginTokens.admin });
  assert.equal(res.status, 403, 'admin must NOT manage users (403)');

  // contract_manager：无 engineering、无订单权限
  res = await api('GET', '/biz/portal/modules', { token: loginTokens.manager });
  assert.ok(!res.data.level1.some((m) => m.code === 'engineering'), 'contract_manager should NOT see engineering');
  res = await api('GET', '/biz/admin/users', { token: loginTokens.manager });
  assert.equal(res.status, 403, 'contract_manager must NOT manage users (403)');

  // city_user：绑定地市；无用户管理
  res = await api('GET', '/biz/auth/me', { token: loginTokens.city });
  assert.equal(res.data.dataScope.scopeType, 'city');
  assert.equal(res.data.dataScope.cityId, jinan.id, 'city_user scope must be bound city');
  res = await api('GET', '/biz/admin/users', { token: loginTokens.city });
  assert.equal(res.status, 403, 'city_user must NOT manage users (403)');

  // 未登录访问受保护 API
  res = await api('GET', '/biz/admin/users', {});
  assert.ok(res.status === 401, 'unauthenticated must be 401');

  // ============ 7. RbacService 数据范围单元断言（super/admin/city） ============
  {
    const ds = createDirectDataSource();
    await ds.initialize();
    const { RbacService } = await import(pathToFileURL(path.join(apiRoot, 'dist', 'rbac', 'rbac.service.js')).href);
    const rbac = new RbacService(
      ds.getRepository('PlatformUserEntity'),
      ds.getRepository('RoleEntity'),
      ds.getRepository('RolePermissionEntity'),
      ds.getRepository('UserPermissionOverrideEntity'),
      ds.getRepository('UserDataScopeEntity'),
      ds.getRepository('CityEntity'),
      ds.getRepository('ProvinceEntity'),
    );
    // city_user 只能使用绑定地市
    const cityCtx = await rbac.loadUserAuthContext(created.city.id);
    await rbac.assertCityScope(cityCtx, jinan.id); // 绑定地市 OK
    await assert.rejects(rbac.assertCityScope(cityCtx, shandong.id), /数据范围不足/, 'city_user other-city must be rejected');
    await assert.rejects(rbac.assertCityScope(cityCtx, randomUUID()), /数据范围不足/);
    // super_admin 任意地市
    const superCtx = await rbac.loadUserAuthContext((await ds.getRepository('PlatformUserEntity').findOneByOrFail({ username: SUPER_ADMIN_USER })).id);
    await rbac.assertCityScope(superCtx, jinan.id);
    await rbac.assertCityScope(superCtx, randomUUID());
    // admin（空 scope = 全部省份）任意地市
    const adminCtx = await rbac.loadUserAuthContext(created.admin.id);
    await rbac.assertCityScope(adminCtx, jinan.id);
    // contract_manager 无业务明细范围
    const managerCtx = await rbac.loadUserAuthContext(created.manager.id);
    await assert.rejects(rbac.assertCityScope(managerCtx, jinan.id), /数据范围不足/, 'contract_manager no city scope');
    await ds.destroy();
  }

  // ============ 8. 登录安全：连续 5 次失败锁定 ============
  for (let i = 0; i < 5; i++) {
    res = await api('POST', '/biz/auth/login', { body: { username: 'm2_admin', password: 'wrong-pass' } });
    assert.equal(res.status, 401, `failure #${i + 1} should be 401`);
  }
  // 第 6 次（即使密码正确）被锁定
  res = await api('POST', '/biz/auth/login', { body: { username: 'm2_admin', password: 'M2-secret-1' } });
  assert.equal(res.status, 401, 'locked account must be rejected even with correct password');

  // ============ 9. 停用立即失效（旧会话） ============
  res = await api('GET', '/biz/auth/me', { token: loginTokens.city });
  assert.equal(res.status, 200, 'city token valid before disable');
  res = await api('PATCH', `/biz/admin/users/${created.city.id}/status`, { token: superToken, body: { status: 'disabled' } });
  assert.equal(res.status, 200);
  res = await api('GET', '/biz/auth/me', { token: loginTokens.city });
  assert.equal(res.status, 401, 'disabled user old session must be invalid immediately');

  console.log('M2_RBAC_AUTH_OK super=wildcard admin=engineer+maintenance manager=contract-only city=bound-scope lock=5-failures disable=immediate');
} finally {
  if (apiProcess && apiProcess.exitCode === null) apiProcess.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 500));
  try {
    rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    console.log(`M2_RBAC_AUTH_CLEANUP_OK root=${testRoot}`);
  } catch (cleanupError) {
    // Windows 上子进程句柄可能短暂占用 sqlite 文件；清理失败不掩盖原始断言错误
    console.error(`M2_RBAC_AUTH_CLEANUP_WARN ${cleanupError?.message ?? cleanupError} root=${testRoot}`);
  }
}
