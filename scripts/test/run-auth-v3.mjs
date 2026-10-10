import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import Module from 'node:module';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(repoRoot, 'apps/api/package.json'));
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-rbac-auth-'));
const dbPath = path.join(tempRoot, 'rbac.sqlite');
const storageRoot = path.join(tempRoot, 'source-files');
const jwtSecret = randomBytes(48).toString('base64url');
const rootPassword = `${randomBytes(18).toString('base64url')}!R7`;
const suffix = randomBytes(6).toString('hex');
let api;

// C-05：dist 为陈旧产物（D8 冻结），改为编译当前 src 到 os.tmpdir() 唯一目录再 spawn，
// 确保端到端验证针对 C-05 新代码而非旧 dist。
const apiRoot = path.join(repoRoot, 'apps/api');
const compiledRoot = path.join(tempRoot, 'compiled');
const compiledMain = path.join(compiledRoot, 'apps/api/src/main.js');
process.env.NODE_PATH = [
  path.join(apiRoot, 'node_modules'),
  path.join(repoRoot, 'node_modules'),
  process.env.NODE_PATH,
].filter(Boolean).join(path.delimiter);
Module._initPaths();
require('reflect-metadata');
{
  const tsc = require.resolve('typescript/bin/tsc');
  execFileSync(
    process.execPath,
    [tsc, '-p', path.join(apiRoot, 'tsconfig.v3-check.json'), '--noEmit', 'false', '--declaration', 'false', '--outDir', compiledRoot, '--pretty', 'false'],
    { cwd: repoRoot, stdio: 'pipe' },
  );
}

const users = {
  root: { username: `root_${suffix}`, name: '隔离根管理员', role: 'root_admin', password: rootPassword },
  contract: { username: `contract_${suffix}`, name: '隔离合同管理员', role: 'contract_manager' },
  system: { username: `system_${suffix}`, name: '隔离系统管理员', role: 'system_admin' },
  city: { username: `city_${suffix}`, name: '隔离地市用户', role: 'city_user', cityId: 91001 },
  scope: { username: `scope_${suffix}`, name: '范围变更用户', role: 'city_user', cityId: 91001 },
};

try {
  const migrationEnv = { ...process.env, NODE_ENV: 'test', DB_TYPE: 'sqlite', DB_DATABASE: dbPath, DB_SYNC: 'false' };
  execFileSync(process.execPath, ['scripts/db/migrate.mjs', 'precheck'], { cwd: repoRoot, env: migrationEnv, stdio: 'inherit' });
  execFileSync(process.execPath, ['scripts/db/migrate.mjs', 'up'], { cwd: repoRoot, env: migrationEnv, stdio: 'inherit' });
  execFileSync(process.execPath, ['scripts/db/migrate.mjs', 'status'], { cwd: repoRoot, env: migrationEnv, stdio: 'inherit' });
  execFileSync(process.execPath, ['scripts/db/migrate.mjs', 'up'], { cwd: repoRoot, env: migrationEnv, stdio: 'inherit' });

  assertJwtStartupRejected(undefined);
  assertJwtStartupRejected('   ');
  console.log('PASS JWT_SECRET production/staging startup gate');

  const db = new Database(dbPath);
  db.prepare(`INSERT INTO cities (id, name, code, sort_order, created_at, updated_at) VALUES
    (91001, '认证隔离甲市', 'RBAC-A', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    (91002, '认证隔离乙市', 'RBAC-B', 2, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run();
  db.prepare(`INSERT INTO users
    (role, name, city_id, openid, username, password_hash, status, auth_version, must_change_password, register_at, created_at, updated_at)
    VALUES ('root_admin', ?, NULL, NULL, ?, ?, 'enabled', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`)
    .run(users.root.name, users.root.username, bcrypt.hashSync(rootPassword, 10));
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM users WHERE role='root_admin'").get().count, 1);
  assert.throws(() => db.prepare(`INSERT INTO users
    (role, name, username, status, auth_version, must_change_password, register_at, created_at, updated_at)
    VALUES ('root_admin', '第二根', ?, 'enabled', 1, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`).run(`second_root_${suffix}`));
  db.close();
  const readiness = execFileSync(process.execPath, ['scripts/auth/promote-root.mjs', '--check'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      RBAC_BOOTSTRAP_DB_TYPE: 'sqlite',
      RBAC_BOOTSTRAP_DB_DATABASE: dbPath,
    },
    encoding: 'utf8',
  });
  assert.match(readiness, /ROOT_READINESS count=1 ready=true/);
  console.log('PASS database unique root constraint');

  const port = await freePort();
  const apiBase = `http://127.0.0.1:${port}/api`;
  api = spawn(process.execPath, [compiledMain], {
    cwd: repoRoot,
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port), DB_TYPE: 'sqlite', DB_DATABASE: dbPath, DB_SYNC: 'false', FACT_SOURCE_STORAGE_ROOT: storageRoot, JWT_SECRET: jwtSecret, AUTH_SECURITY_HMAC_KEY: randomBytes(48).toString('base64url'), TRUST_PROXY_HOPS: '1', WECHAT_LOGIN_MODE: 'mock' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  api.stdout.resume();
  api.stderr.on('data', (chunk) => process.stderr.write(`[api] ${chunk}`));
  await waitForApi(apiBase, api);

  const rootLogin = await login(apiBase, 'admin', users.root.username, rootPassword);
  assert.equal(rootLogin.user.role, 'root_admin');
  assert.deepEqual(Object.keys(decodeJwt(rootLogin.token)).sort(), ['aud', 'authVersion', 'cityId', 'exp', 'iat', 'iss', 'role', 'sub'].sort());
  assert.equal(decodeJwt(rootLogin.token).iss, 'biz-reporting-api');
  assert.equal(decodeJwt(rootLogin.token).aud, 'biz-reporting-clients');
  console.log('PASS JWT issuer/audience claims (C-05)');

  const registrationDb = new Database(dbPath, { readonly: true });
  const userCountBeforeRegistrationAttempts = registrationDb.prepare('SELECT COUNT(*) AS count FROM users').get().count;
  registrationDb.close();
  for (const endpoint of ['/auth/city/register', '/auth/wechat/register']) {
    const rejected = await requestJson(apiBase, endpoint, { method: 'POST', body: { username: 'public', password: 'PublicPass123!' }, expected: 404 });
    assert.equal(typeof rejected?.token, 'undefined');
  }
  const registrationEvidenceDb = new Database(dbPath, { readonly: true });
  assert.equal(registrationEvidenceDb.prepare('SELECT COUNT(*) AS count FROM users').get().count, userCountBeforeRegistrationAttempts);
  registrationEvidenceDb.close();
  console.log('PASS public registration routes removed');

  for (const key of ['contract', 'system', 'city', 'scope']) {
    const spec = users[key];
    const created = await requestJson(apiBase, '/admin/users', { token: rootLogin.token, method: 'POST', body: { username: spec.username, name: spec.name, role: spec.role, cityId: spec.cityId ?? null }, expected: 201 });
    assert.equal(created.user.role, spec.role);
    assert.ok(created.temporaryPassword.length >= 8);
    spec.id = created.user.id;
    spec.temporaryPassword = created.temporaryPassword;
    spec.password = `${randomBytes(18).toString('base64url')}!N8`;
  }
  const secondRoot = await requestJson(apiBase, '/admin/users', { token: rootLogin.token, method: 'POST', body: { username: `forbidden_root_${suffix}`, name: '禁止根', role: 'root_admin' }, expected: 400 });
  assert.match(secondRoot.message, /根账号/);

  const logins = {};
  const userIp = { contract: '10.1.0.10', system: '10.1.0.11', city: '10.1.0.12', scope: '10.1.0.13' };
  for (const key of ['contract', 'system', 'city', 'scope']) {
    const spec = users[key];
    const channel = spec.role === 'city_user' ? 'city' : 'admin';
    const temporaryLogin = await login(apiBase, channel, spec.username, spec.temporaryPassword, 200, userIp[key]);
    assert.equal(temporaryLogin.user.mustChangePassword, true);
    await requestJson(apiBase, spec.role === 'city_user' ? '/city/facts/contracts' : '/admin/contracts', { token: temporaryLogin.token, expected: 403 });
    await requestJson(apiBase, '/me', { token: temporaryLogin.token, expected: 200 });
    await requestJson(apiBase, '/auth/logout', { token: temporaryLogin.token, method: 'POST', expected: 200 });
    await requestJson(apiBase, '/me/password', { token: temporaryLogin.token, method: 'PATCH', body: { currentPassword: spec.temporaryPassword, newPassword: spec.password, confirmPassword: spec.password }, expected: 200 });
    await requestJson(apiBase, '/me', { token: temporaryLogin.token, expected: 401 });
    await login(apiBase, channel, spec.username, spec.temporaryPassword, 401, userIp[key]);
    logins[key] = await login(apiBase, channel, spec.username, spec.password, 200, userIp[key]);
    assert.equal(logins[key].user.mustChangePassword, false);
  }
  await login(apiBase, 'admin', users.city.username, users.city.password, 401, '10.1.0.20');
  await login(apiBase, 'city', users.system.username, users.system.password, 401, '10.1.0.21');
  console.log('PASS temporary password restriction, password change, old password/JWT revocation');

  const rejectedNewPassword = `${randomBytes(18).toString('base64url')}!P9`;
  await requestJson(apiBase, '/me/password', { token: logins.city.token, method: 'PATCH', body: { currentPassword: 'not-the-current-password', newPassword: rejectedNewPassword, confirmPassword: rejectedNewPassword }, expected: 401 });
  await requestJson(apiBase, '/me/password', { token: logins.city.token, method: 'PATCH', body: { currentPassword: users.city.password, newPassword: rejectedNewPassword, confirmPassword: `${rejectedNewPassword}x` }, expected: 400 });
  const previousCityPassword = users.city.password;
  users.city.password = `${randomBytes(18).toString('base64url')}!Q6`;
  const previousCityToken = logins.city.token;
  await requestJson(apiBase, '/me/password', { token: previousCityToken, method: 'PATCH', body: { currentPassword: previousCityPassword, newPassword: users.city.password, confirmPassword: users.city.password }, expected: 200 });
  await requestJson(apiBase, '/me', { token: previousCityToken, expected: 401 });
  await login(apiBase, 'city', users.city.username, previousCityPassword, 401, userIp.city);
  logins.city = await login(apiBase, 'city', users.city.username, users.city.password, 200, userIp.city);
  console.log('PASS normal password validation and session revocation');

  await requestJson(apiBase, '/admin/dashboard', { token: rootLogin.token, expected: 200 });
  await requestJson(apiBase, '/admin/users', { token: rootLogin.token, expected: 200 });
  await requestJson(apiBase, `/admin/users/${users.root.id ?? 1}/status`, { token: rootLogin.token, method: 'PATCH', body: { status: 'disabled' }, expected: 403 });
  await requestJson(apiBase, `/admin/users/${users.root.id ?? 1}/role`, { token: rootLogin.token, method: 'PATCH', body: { role: 'system_admin' }, expected: 403 });

  await requestJson(apiBase, '/admin/contracts', { token: logins.contract.token, expected: 200 });
  await requestJson(apiBase, '/cities', { token: logins.contract.token, expected: 200 });
  await requestJson(apiBase, '/admin/dashboard', { token: logins.contract.token, expected: 403 });
  const contract = await requestJson(apiBase, '/admin/contracts', { token: logins.contract.token, method: 'POST', body: { contractCode: `RBAC-${suffix}`, contractName: 'RBAC 隔离合同', contractAmount: 100000, rate: 0.1 }, expected: 201 });
  assert.ok(contract.id);
  await requestJson(apiBase, '/admin/contracts/all/purge', { token: logins.contract.token, method: 'DELETE', expected: 403 });

  await requestJson(apiBase, '/admin/dashboard', { token: logins.system.token, expected: 200 });
  await requestJson(apiBase, '/admin/contracts', { token: logins.system.token, expected: 200 });
  await requestJson(apiBase, '/admin/contracts', { token: logins.system.token, method: 'POST', body: { contractCode: 'DENIED', contractName: 'Denied', contractAmount: 1, rate: 0.1 }, expected: 403 });
  await requestJson(apiBase, '/admin/users', { token: logins.system.token, expected: 403 });

  const cityContracts = await requestJson(apiBase, '/city/facts/contracts?year=2026&cityId=91002', { token: logins.city.token, expected: 200 });
  assert.ok(Array.isArray(cityContracts));
  assert.ok(cityContracts.every((item) => item.cityId === 91001));
  await requestJson(apiBase, '/admin/contracts', { token: logins.city.token, expected: 403 });
  await requestJson(apiBase, '/admin/dashboard', { token: logins.city.token, expected: 403 });
  console.log('PASS four-role positive/negative permissions and city scope');

  for (const token of [logins.city.token, logins.contract.token]) {
    await requestJson(apiBase, '/admin/packages', { token, expected: 403 });
    await requestJson(apiBase, '/admin/import-jobs', { token, expected: 403 });
    await requestJson(apiBase, '/admin/imports/contracts/upload', { token, method: 'POST', expected: 403 });
    await requestJson(apiBase, '/admin/reminders/send', { token, method: 'POST', body: { year: 2026, month: 1, cityIds: [91001] }, expected: 403 });
    await requestJson(apiBase, '/admin/ai/query', { token, method: 'POST', body: { question: '只读检查' }, expected: 403 });
  }
  await requestJson(apiBase, '/city/packages/current?year=2026', { token: logins.system.token, expected: 403 });
  await requestJson(apiBase, '/admin/packages', { token: rootLogin.token, expected: 200 });
  await requestJson(apiBase, '/admin/import-jobs', { token: rootLogin.token, expected: 200 });
  console.log('PASS global legacy @Roles compatibility guard');

  const invite = await requestJson(apiBase, `/admin/users/${users.city.id}/wechat-invitations`, { token: rootLogin.token, method: 'POST', expected: 201 });
  await requestJson(apiBase, '/auth/wechat/bind', { method: 'POST', body: { invitationToken: invite.invitationToken, code: `bind_${suffix}` }, expected: 200 });
  await requestJson(apiBase, '/auth/wechat/bind', { method: 'POST', body: { invitationToken: invite.invitationToken, code: `replay_${suffix}` }, expected: 401 });
  const expired = await requestJson(apiBase, `/admin/users/${users.scope.id}/wechat-invitations`, { token: rootLogin.token, method: 'POST', expected: 201 });
  const expireDb = new Database(dbPath);
  expireDb.prepare('UPDATE auth_wechat_invitations SET expires_at = ? WHERE token_hash = ?').run('2000-01-01 00:00:00', sha256(expired.invitationToken));
  expireDb.close();
  await requestJson(apiBase, '/auth/wechat/bind', { method: 'POST', body: { invitationToken: expired.invitationToken, code: `expired_${suffix}` }, expected: 401 });
  await requestJson(apiBase, '/me', { token: logins.city.token, expected: 401 });
  const cityRelogin = await login(apiBase, 'city', users.city.username, users.city.password, 200, '10.1.0.14');
  console.log('PASS WeChat invitation bind, replay and expiry');

  const oldScopeToken = logins.scope.token;
  await requestJson(apiBase, `/admin/users/${users.scope.id}/city`, { token: rootLogin.token, method: 'PATCH', body: { cityId: 91002 }, expected: 200 });
  await requestJson(apiBase, '/me', { token: oldScopeToken, expected: 401 });
  const scopeRelogin = await login(apiBase, 'city', users.scope.username, users.scope.password, 200, userIp.scope);
  assert.equal((await requestJson(apiBase, '/me', { token: scopeRelogin.token, expected: 200 })).cityId, 91002);

  await requestJson(apiBase, `/admin/users/${users.system.id}/reset-password`, { token: rootLogin.token, method: 'POST', expected: 201 });
  await requestJson(apiBase, '/me', { token: logins.system.token, expected: 401 });
  await requestJson(apiBase, `/admin/users/${users.contract.id}/status`, { token: rootLogin.token, method: 'PATCH', body: { status: 'disabled' }, expected: 200 });
  await requestJson(apiBase, '/me', { token: logins.contract.token, expected: 401 });
  console.log('PASS scope/status/reset authVersion revocation');

  await requestJson(apiBase, '/exports/audit', { token: cityRelogin.token, method: 'POST', body: { pageName: '本地市订单', scopeLabel: '伪造范围', filters: { year: 2026 }, rowCount: 12, result: 'success', fileName: 'test.xlsx' }, expected: 201 });
  await requestJson(apiBase, '/auth/logout', { token: rootLogin.token, method: 'POST', expected: 200 });
  await requestJson(apiBase, '/me', { token: `${rootLogin.token}invalid`, expected: 401 });

  const evidenceDb = new Database(dbPath, { readonly: true });
  const auditRows = evidenceDb.prepare('SELECT action_type, operator_city_id, before_data_json, after_data_json FROM operation_logs').all();
  assert.ok(auditRows.some((row) => row.action_type === 'account_create'));
  assert.ok(auditRows.some((row) => row.action_type === 'own_password_change'));
  assert.ok(auditRows.some((row) => row.action_type === 'wechat_identity_bind'));
  assert.ok(auditRows.some((row) => row.action_type === 'page_export' && Number(row.operator_city_id) === 91001));
  const auditText = JSON.stringify(auditRows);
  for (const spec of Object.values(users)) {
    if (spec.password) assert.equal(auditText.includes(spec.password), false);
    if (spec.temporaryPassword) assert.equal(auditText.includes(spec.temporaryPassword), false);
  }
  assert.equal(auditText.includes(invite.invitationToken), false);
  const migrationCount = evidenceDb.prepare("SELECT COUNT(*) AS count FROM schema_migrations WHERE version='007_rbac_auth'").get().count;
  assert.equal(migrationCount, 1);
  evidenceDb.close();
  console.log('PASS audit evidence contains no password/token secret');

  // ---- C-05：旧 JWT secret / 缺失 issuer-audience 的 token 必须失效 ----
  const forgedHeader = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const forgedPayload = Buffer.from(JSON.stringify({ sub: users.root.id, role: 'root_admin', cityId: null, authVersion: 1 })).toString('base64url');
  const forgedSignature = createHmac('sha256', 'wrong-secret').update(`${forgedHeader}.${forgedPayload}`).digest('base64url');
  const forgedToken = `${forgedHeader}.${forgedPayload}.${forgedSignature}`;
  await requestJson(apiBase, '/me', { token: forgedToken, expected: 401 });
  console.log('PASS old JWT secret / missing issuer-audience token rejected (C-05)');

  // ---- C-05：同一 IP 连续登录失败触发 429（Throttler 5/min 覆盖登录端点）----
  const rateStatuses = [];
  for (let i = 0; i < 6; i += 1) {
    const response = await fetch(`${apiBase}/auth/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: `rate_probe_${suffix}`, password: 'WrongPass123!' }),
    });
    await response.arrayBuffer();
    rateStatuses.push(response.status);
  }
  assert.ok(
    rateStatuses.includes(429),
    `C-05 期望登录端点触发 429（Throttler 5/min），实测状态序列=${JSON.stringify(rateStatuses)}`,
  );
  console.log(`PASS login endpoint throttles to 429 after 5 attempts: ${JSON.stringify(rateStatuses)} (C-05)`);

  console.log(`RBAC_AUTH_SETTINGS_INTEGRATION_OK db=${dbPath}`);
} finally {
  if (api && api.exitCode === null) {
    api.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => api.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 5000))]);
    if (api.exitCode === null) {
      api.kill('SIGKILL');
      await Promise.race([new Promise((resolve) => api.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 5000))]);
    }
  }
  if (process.platform === 'win32' && api?.pid) {
    spawnSync('taskkill', ['/PID', String(api.pid), '/T', '/F'], { stdio: 'ignore' });
  }
  let cleanupError;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true });
      cleanupError = undefined;
      break;
    } catch (error) {
      cleanupError = error;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (cleanupError) {
    const cleaner = spawn(process.execPath, ['-e', "const fs=require('node:fs');setTimeout(()=>fs.rmSync(process.argv[1],{recursive:true,force:true,maxRetries:20,retryDelay:250}),500)", tempRoot], {
      detached: true,
      stdio: 'ignore',
    });
    cleaner.unref();
    console.log(`RBAC_AUTH_SETTINGS_CLEANUP_DEFERRED root=${tempRoot}`);
  } else {
    console.log(`RBAC_AUTH_SETTINGS_CLEANUP_OK root=${tempRoot}`);
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function decodeJwt(token) {
  return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
}

async function login(apiBase, channel, username, password, expected = 200, ip) {
  return requestJson(apiBase, `/auth/${channel}/login`, { method: 'POST', body: { username, password }, expected, ...(ip ? { headers: { 'X-Forwarded-For': ip } } : {}) });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForApi(apiBase, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API_EXITED code=${child.exitCode}`);
    try { if ((await fetch(apiBase)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('API_START_TIMEOUT');
}

async function requestJson(apiBase, pathname, { token, method = 'GET', body, expected, headers }) {
  const response = await fetch(`${apiBase}${pathname}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(headers || {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => null);
  assert.equal(response.status, expected, `${method} ${pathname}: ${response.status} ${JSON.stringify(data)}`);
  return data;
}

function assertJwtStartupRejected(jwtSecretValue) {
  const env = { ...process.env, NODE_ENV: 'production', DEPLOY_ENV: 'staging', PORT: '0', DB_TYPE: 'sqlite', DB_DATABASE: dbPath, DB_SYNC: 'false', FACT_SOURCE_STORAGE_ROOT: storageRoot };
  if (jwtSecretValue === undefined) delete env.JWT_SECRET; else env.JWT_SECRET = jwtSecretValue;
  const result = spawnSync(process.execPath, [compiledMain], { cwd: tempRoot, env, encoding: 'utf8', timeout: 10_000 });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  assert.notEqual(result.status, 0);
  assert.match(output, /\[AUTH_CONFIG\] JWT_SECRET is required and must not be empty/);
}
