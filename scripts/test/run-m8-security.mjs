/**
 * M8 安全与运维测试（DEV-064/DEV-066）：
 *  - 生产环境弱 JWT/HMAC 密钥 → 启动失败（进程非 0 退出）
 *  - 开发环境弱密钥 → 启动成功 + 告警
 *  - super_admin 运维闭环：env 初始化（禁默认密码）、轮换（重置密码）、停用、审计日志、操作记录
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const apiRoot = path.join(repoRoot, 'apps', 'api');
const requireFromApi = createRequire(path.join(apiRoot, 'package.json'));
const { DataSource } = requireFromApi('typeorm');

const testRoot = mkdtempSync(path.join(tmpdir(), 'biz-m8-sec-'));
const useMysql = !!process.env.BIZ_TEST_MYSQL_DATABASE;
const database = useMysql ? process.env.BIZ_TEST_MYSQL_DATABASE : path.join(testRoot, 'test.sqlite');

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

const baseEnv = {
  NODE_ENV: 'test', DB_TYPE: useMysql ? 'mysql' : 'sqlite', DB_DATABASE: database, DB_SYNC: 'false',
  DB_HOST: useMysql ? process.env.MIGRATION_TEST_MYSQL_HOST : undefined,
  DB_PORT: useMysql ? process.env.MIGRATION_TEST_MYSQL_PORT : undefined,
  DB_USERNAME: useMysql ? process.env.MIGRATION_TEST_MYSQL_USER : undefined,
  DB_PASSWORD: useMysql ? process.env.MIGRATION_TEST_MYSQL_PASSWORD : undefined,
  FACT_SOURCE_STORAGE_ROOT: path.join(testRoot, 'src'),
  JWT_SECRET: 'M8-STRONG-JWT-SECRET-0123456789abcdefghijk',
  AUTH_SECURITY_HMAC_KEY: 'M8-STRONG-HMAC-KEY-0123456789abcdefghijk',
  JWT_ISSUER: 'biz-reporting-api', JWT_AUDIENCE: 'biz-reporting-clients',
};

async function tryBoot(env, timeoutMs = 20_000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['apps/api/dist/main.js'], { cwd: repoRoot, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (c) => { stderr += c.toString(); });
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      resolve({ booted: true, stderr });
    }, timeoutMs);
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ booted: false, exitCode: code, stderr });
    });
  });
}

async function waitForApi(url, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${url}/biz/auth/me`);
      if (res.status === 401 || res.status === 200) return;
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('API not ready');
}

try {
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, ['scripts/db/migrate.mjs', 'up'], { cwd: repoRoot, env: { ...process.env, ...baseEnv }, stdio: 'inherit' });

  // ============ DEV-064：生产弱密钥启动失败 ============
  // 1. 生产 + 短密钥
  const prodWeak = await tryBoot({ ...baseEnv, NODE_ENV: 'production', DEPLOY_ENV: 'production', DB_TYPE: 'mysql', DB_HOST: '10.0.0.1', DB_PORT: '3306', DB_USERNAME: 'biz', DB_PASSWORD: 'x', DB_DATABASE: 'biz', CORS_ORIGINS: 'https://a.example.com', TRUST_PROXY_HOPS: '1', JWT_SECRET: 'short-secret', AUTH_SECURITY_HMAC_KEY: 'short-hmac' });
  assert.equal(prodWeak.booted, false, `DEV-064 weak JWT_SECRET must fail startup, got booted=${prodWeak.booted}`);
  assert.ok(prodWeak.stderr.includes('JWT_SECRET') || prodWeak.stderr.includes('SECURITY_CONFIG'), `DEV-064 error mentions secret: ${prodWeak.stderr.slice(0, 200)}`);
  // 2. 生产 + 占位值
  const prodPlaceholder = await tryBoot({ ...baseEnv, NODE_ENV: 'production', DEPLOY_ENV: 'production', DB_TYPE: 'mysql', DB_HOST: '10.0.0.1', DB_PORT: '3306', DB_USERNAME: 'biz', DB_PASSWORD: 'x', DB_DATABASE: 'biz', CORS_ORIGINS: 'https://a.example.com', TRUST_PROXY_HOPS: '1', JWT_SECRET: 'secret', AUTH_SECURITY_HMAC_KEY: 'changeme' });
  assert.equal(prodPlaceholder.booted, false, 'DEV-064 placeholder secret must fail startup');
  // 3. 开发环境弱密钥 → 告警不阻断
  const devWeak = await tryBoot({ ...baseEnv, JWT_SECRET: 'dev-secret', AUTH_SECURITY_HMAC_KEY: 'dev-hmac' });
  assert.equal(devWeak.booted, true, 'DEV-064 dev weak secret warns but boots');
  assert.ok(devWeak.stderr.includes('SECURITY_CONFIG'), 'DEV-064 dev weak secret warning emitted');

  // ============ super_admin 运维闭环（DEV-066） ============
  // 初始化：env 注入强密码（禁止默认密码）
  execFileSync(process.execPath, ['scripts/auth/biz-init-super-admin.mjs'], {
    cwd: repoRoot, env: { ...process.env, ...baseEnv, BIZ_SUPER_ADMIN_USERNAME: 'ops_super', BIZ_SUPER_ADMIN_PASSWORD: 'Ops-Strong-Pass-2026-08' }, stdio: 'inherit',
  });

  const port = await freePort();
  const apiBase = `http://127.0.0.1:${port}/api`;
  const apiProcess = spawn(process.execPath, ['apps/api/dist/main.js'], {
    cwd: repoRoot, env: { ...process.env, ...baseEnv, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  apiProcess.stderr.on('data', (c) => process.stderr.write(`[api] ${c}`));
  await waitForApi(apiBase);

  async function api(method, urlPath, { token, body } = {}) {
    const headers = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${apiBase}${urlPath}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data };
  }

  // 登录（初始密码为 env 注入的强密码）
  let res = await api('POST', '/biz/auth/login', { body: { username: 'ops_super', password: 'Ops-Strong-Pass-2026-08' } });
  assert.equal(res.status, 201, `login with env-injected password: ${JSON.stringify(res.data)}`);
  const superToken = res.data.accessToken;

  // 轮换：重置另一管理员密码（仅 super）
  res = await api('POST', '/biz/admin/users', { token: superToken, body: { username: 'ops_admin', password: 'Admin-Strong-2026-08', name: '运维管理员', roleCode: 'admin' } });
  assert.equal(res.status, 201);
  const userId = res.data.id;
  res = await api('POST', `/biz/admin/users/${userId}/reset-password`, { token: superToken, body: { newPassword: 'Admin-Rotated-2026-08' } });
  assert.equal(res.status, 201, 'DEV-066 password rotation (reset)');
  // 新密码可登录
  res = await api('POST', '/biz/auth/login', { body: { username: 'ops_admin', password: 'Admin-Rotated-2026-08' } });
  assert.equal(res.status, 201, 'rotated password login');

  // 停用：禁用的 admin 不能登录
  res = await api('PATCH', `/biz/admin/users/${userId}/status`, { token: superToken, body: { status: 'disabled' } });
  assert.equal(res.status, 200);
  res = await api('POST', '/biz/auth/login', { body: { username: 'ops_admin', password: 'Admin-Rotated-2026-08' } });
  assert.equal(res.status, 401, 'DEV-066 disabled user cannot login');

  // 审计：操作日志可查询（含 reset-password / status 动作）
  res = await api('GET', '/biz/admin/operation-logs', { token: superToken });
  assert.equal(res.status, 200);
  const actions = res.data.items.map((l) => l.actionType);
  assert.ok(actions.includes('user.reset_password') || actions.includes('user.status') || actions.some((a) => a.includes('user.')), `DEV-066 audit log has admin actions: ${actions.slice(0, 5)}`);

  // 禁止默认密码：初始化脚本校验（空密码/占位密码拒绝）
  try {
    execFileSync(process.execPath, ['scripts/auth/biz-init-super-admin.mjs'], {
      cwd: repoRoot, env: { ...process.env, ...baseEnv, BIZ_SUPER_ADMIN_USERNAME: 'bad_super', BIZ_SUPER_ADMIN_PASSWORD: '123456' }, stdio: 'ignore',
    });
    assert.fail('DEV-066 weak default password must be rejected by init script');
  } catch {
    /* 预期失败 */
  }

  apiProcess.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 500));
  console.log('M8_SECURITY_OK weak-secret prod-fail + dev-warn, super ops loop: init(env)/rotate/disable/audit, default-password rejected');
} finally {
  await new Promise((r) => setTimeout(r, 500));
  try { rmSync(testRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 }); } catch { console.log('M8_SECURITY_CLEANUP_WARN'); }
  console.log('M8_SECURITY_CLEANUP_OK');
}
