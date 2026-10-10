/**
 * C-04 登录安全回归测试（B-03 红测扩展）
 *
 * 历史：B-03 阶段二创建本文件作为红测，覆盖 DEV-003（DTO 应为 class）与 AUTH-2（缺 password 应 400）。
 *       C-05 已修复（shared-types interface→class + 本地 class DTO + ValidationPipe 恢复生效），
 *       本文件按 Codex F-01 纠偏令启用全部 3 个 DEV-003/AUTH-2 测试为 HTTP 级验证（spawn 编译产物 → fetch 400），
 *       最终要求 11 pass / 0 skip / 0 fail。
 *
 * C-04 负责登录哈希桶 + 安全事件实体/服务（design.md 6.2/6.3）：
 *  - 实体逐字段映射 009（auth_login_rate_limits / auth_security_events），不建立 user FK
 *  - HMAC-SHA256(AUTH_SECURITY_HMAC_KEY, route + '\0' + normalizedSubject)，ip 前缀 'ip\0'
 *  - 数据库事务 + pessimistic_write（MySQL FOR UPDATE；sqlite 单连接串行化，驱动不支持锁则跳过）
 *  - 第 5 次失败锁定 blocked_until=now+AUTH_ACCOUNT_BLOCK_MS；超过窗口先清零；成功清计数
 *  - 审计事件只写哈希；审计写失败 → 503 稳定错误码，禁止静默成功
 *
 * 执行：node apps/api/test/login-security.test.cjs（node:test，零新增依赖）
 * C-04 套件可用 --test-name-pattern 'C-04' 单独运行。
 */
'use strict';

const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const Module = require('node:module');
const { createRequire } = require('node:module');

const test = require('node:test');
const assert = require('node:assert/strict');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const API_ROOT = path.join(REPO_ROOT, 'apps', 'api');
const apiRequire = createRequire(path.join(API_ROOT, 'package.json'));

let compiledRoot = null;
let tempRoot = null;
let apiChild = null;
let apiBase = null;
let apiTempRoot = null;

function compileCurrentSrc() {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-c04-login-'));
  compiledRoot = path.join(tempRoot, 'compiled');
  process.env.NODE_PATH = [
    path.join(API_ROOT, 'node_modules'),
    path.join(REPO_ROOT, 'node_modules'),
    process.env.NODE_PATH,
  ].filter(Boolean).join(path.delimiter);
  Module._initPaths();
  require('reflect-metadata');
  const tsc = apiRequire.resolve('typescript/bin/tsc');
  execFileSync(
    process.execPath,
    [tsc, '-p', path.join(API_ROOT, 'tsconfig.v3-check.json'), '--noEmit', 'false', '--declaration', 'false', '--outDir', compiledRoot, '--pretty', 'false'],
    { cwd: REPO_ROOT, stdio: 'pipe' },
  );
}

function compiled(rel) {
  return require(path.join(compiledRoot, 'apps', 'api', 'src', rel));
}

/* ============================================================
 * HTTP 级验证（DEV-003/AUTH-2）：spawn 编译产物，验证 ValidationPipe
 * 对缺 username / 缺 password 返回 400（C-05 修复后生效）。
 * ============================================================ */

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitForApi(base, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API_EXITED code=${child.exitCode}`);
    try {
      if ((await fetch(`${base}/health/live`)).ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('API_START_TIMEOUT');
}

async function startApi() {
  apiTempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-c05-http-'));
  const port = await freePort();
  apiBase = `http://127.0.0.1:${port}/api`;
  const compiledMain = path.join(compiledRoot, 'apps', 'api', 'src', 'main.js');
  apiChild = spawn(process.execPath, [compiledMain], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      DB_TYPE: 'sqlite',
      DB_DATABASE: path.join(apiTempRoot, 'http.sqlite'),
      DB_SYNC: 'false',
      FACT_SOURCE_STORAGE_ROOT: path.join(apiTempRoot, 'source-files'),
      JWT_SECRET: crypto.randomBytes(48).toString('base64url'),
      AUTH_SECURITY_HMAC_KEY: crypto.randomBytes(48).toString('base64url'),
      TRUST_PROXY_HOPS: '1',
      WECHAT_LOGIN_MODE: 'mock',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForApi(apiBase, apiChild);
}

async function stopApi() {
  if (apiChild) {
    const child = apiChild;
    apiChild = null;
    child.kill();
    // 等待子进程完全退出释放 sqlite 文件句柄，再清理临时目录
    await new Promise((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) return resolve();
      child.once('exit', resolve);
      setTimeout(resolve, 4000);
    });
  }
  if (apiTempRoot && fs.existsSync(apiTempRoot)) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        fs.rmSync(apiTempRoot, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    apiTempRoot = null;
  }
}

test.before(async () => {
  compileCurrentSrc();
  // C-05/F-01：DEV-003/AUTH-2 三测试为 HTTP 级（ValidationPipe 语义），spawn 编译产物
  await startApi();
});

test.after(async () => {
  await stopApi();
  if (tempRoot && fs.existsSync(tempRoot)) {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

/* ============================================================
 * DEV-003 / AUTH-2 修复验证（C-05 已修复，F-01 纠偏令启用）
 * 断言严格为 HTTP 400（ValidationPipe 语义），不放松为"非 500"。
 * ============================================================ */

test('DEV-003 根因：AdminLoginRequest 运行时必须是 class（shared-types interface→class 修复实证）', () => {
  const dtoModule = require(path.join(compiledRoot, 'packages', 'shared-types', 'src', 'common', 'auth.dto.js'));
  assert.equal(typeof dtoModule.AdminLoginRequest, 'function', 'DEV-003: AdminLoginRequest 应为 class（interface 编译擦除 → ValidationPipe 失效）');
});

test('DEV-003 行为：adminLogin 缺 username → HTTP 400（ValidationPipe 生效，不再 500）', async () => {
  const response = await fetch(`${apiBase}/auth/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'SomePassword123!' }),
  });
  const status = response.status;
  await response.arrayBuffer();
  assert.equal(status, 400, `DEV-003: 缺 username 应返回 HTTP 400（ValidationPipe 拦截），实测 ${status}（旧代码 500）`);
});

test('AUTH-2 行为：adminLogin 缺 password → HTTP 400（ValidationPipe 生效，不再 401）', async () => {
  const response = await fetch(`${apiBase}/auth/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin' }),
  });
  const status = response.status;
  await response.arrayBuffer();
  assert.equal(status, 400, `AUTH-2: 缺 password 应返回 HTTP 400（ValidationPipe 拦截），实测 ${status}（旧代码 401）`);
});

/* ============================================================
 * C-04 登录安全服务回归套件
 * ============================================================ */

const HMAC_TEST_KEY = 'c04-test-hmac-key-not-a-real-secret';

function makeConfig(overrides) {
  const values = {
    AUTH_SECURITY_HMAC_KEY: HMAC_TEST_KEY,
    AUTH_ACCOUNT_WINDOW_MS: '900000',
    AUTH_ACCOUNT_MAX_FAILURES: '5',
    AUTH_ACCOUNT_BLOCK_MS: '900000',
    ...(overrides || {}),
  };
  return { get: (key, def) => (Object.hasOwn(values, key) ? values[key] : def) };
}

function newService(entities, overrides) {
  const { LoginSecurityService } = compiled('auth/login-security.service.js');
  const { DataSource } = apiRequire('typeorm');
  const ds = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities, synchronize: true });
  return ds.initialize().then(() => ({ ds, service: new LoginSecurityService(ds, makeConfig(overrides)) }));
}

function ctx(ip) {
  return { ip: ip || '203.0.113.9', requestId: 'req-' + Math.random().toString(36).slice(2) };
}

function failure(route, subject, opts) {
  const options = opts || {};
  return {
    route,
    subject,
    context: ctx(options.ip),
    outcome: 'failed',
    reasonCode: options.reasonCode || 'PASSWORD_MISMATCH',
    userId: options.userId ?? null,
    cityId: options.cityId ?? null,
  };
}

function success(route, subject, opts) {
  const options = opts || {};
  return {
    route,
    subject,
    context: ctx(options.ip),
    outcome: 'success',
    reasonCode: 'LOGIN_OK',
    userId: options.userId ?? null,
    cityId: options.cityId ?? null,
  };
}

test('C-04 实体：auth_login_rate_limits / auth_security_events 逐字段映射 009，无 user FK，无多余列', async () => {
  const { AuthLoginRateLimitEntity } = compiled('auth/auth-login-rate-limit.entity.js');
  const { AuthSecurityEventEntity } = compiled('auth/auth-security-event.entity.js');
  const { DataSource } = apiRequire('typeorm');
  const ds = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [AuthLoginRateLimitEntity, AuthSecurityEventEntity], synchronize: true });
  await ds.initialize();
  try {
    const rateCols = await ds.query("PRAGMA table_info('auth_login_rate_limits')");
    const rateNames = new Set(rateCols.map((r) => r.name));
    for (const column of ['id', 'route_key', 'subject_hash', 'window_started_at', 'attempt_count', 'blocked_until', 'updated_at']) {
      assert.ok(rateNames.has(column), `auth_login_rate_limits 缺列: ${column}`);
    }
    assert.ok(!rateNames.has('created_at'), 'auth_login_rate_limits 不得有 created_at（009 无此列）');

    const eventCols = await ds.query("PRAGMA table_info('auth_security_events')");
    const eventNames = new Set(eventCols.map((r) => r.name));
    for (const column of ['id', 'event_type', 'outcome', 'route_key', 'subject_hash', 'ip_hash', 'user_id', 'city_id', 'reason_code', 'request_id', 'created_at']) {
      assert.ok(eventNames.has(column), `auth_security_events 缺列: ${column}`);
    }

    const rateFks = await ds.query("PRAGMA foreign_key_list('auth_login_rate_limits')");
    assert.equal(rateFks.length, 0, 'auth_login_rate_limits 不得有外键');
    const eventFks = await ds.query("PRAGMA foreign_key_list('auth_security_events')");
    assert.equal(eventFks.length, 0, 'auth_security_events 不得建立 user 外键（失败尝试也必须可记录）');
  } finally {
    await ds.destroy();
  }
});

test('C-04 HMAC：subject/ip 哈希稳定、路由与域分隔、64 hex、不泄露明文', async () => {
  const { AuthLoginRateLimitEntity, AuthSecurityEventEntity } = (() => {
    const rate = compiled('auth/auth-login-rate-limit.entity.js');
    const evt = compiled('auth/auth-security-event.entity.js');
    return { AuthLoginRateLimitEntity: rate.AuthLoginRateLimitEntity, AuthSecurityEventEntity: evt.AuthSecurityEventEntity };
  })();
  const { ds, service } = await newService([AuthLoginRateLimitEntity, AuthSecurityEventEntity]);
  try {
    const h1 = service.hashSubject('admin_login', 'root_user');
    const h2 = service.hashSubject('admin_login', 'root_user');
    assert.equal(h1, h2, '同一 route+subject 哈希必须稳定');
    assert.match(h1, /^[a-f0-9]{64}$/, 'subject_hash 必须是 64 位 hex');
    assert.notEqual(h1, service.hashSubject('city_login', 'root_user'), '不同 route 不得同哈希');
    assert.notEqual(h1, service.hashSubject('admin_login', 'other_user'), '不同 subject 不得同哈希');
    assert.equal(service.hashSubject('admin_login', ' root_user '), h1, 'subject 规范化（trim）后哈希一致');
    const ip1 = service.hashIp('203.0.113.9');
    assert.equal(ip1, service.hashIp('203.0.113.9'), '同一 IP 哈希稳定');
    assert.match(ip1, /^[a-f0-9]{64}$/, 'ip_hash 必须是 64 位 hex');
    assert.notEqual(ip1, h1, 'ip 域必须与 subject 域分隔（ip\\0 前缀）');
    assert.ok(!h1.includes('root_user') && !ip1.includes('203.0.113.9'), '哈希不得包含明文');
  } finally {
    await ds.destroy();
  }
});

test('C-04 锁定：第 5 次失败锁定 blocked_until≈now+AUTH_ACCOUNT_BLOCK_MS，assertAllowed 拦截，审计齐全', async () => {
  const rate = compiled('auth/auth-login-rate-limit.entity.js');
  const evt = compiled('auth/auth-security-event.entity.js');
  const { ds, service } = await newService([rate.AuthLoginRateLimitEntity, evt.AuthSecurityEventEntity]);
  try {
    for (let i = 1; i <= 4; i += 1) await service.recordFailure(failure('admin_login', 'root_user'));
    await service.assertAllowed('admin_login', 'root_user'); // 4 次未锁定

    await service.recordFailure(failure('admin_login', 'root_user')); // 第 5 次 → 锁定
    await assert.rejects(service.assertAllowed('admin_login', 'root_user'), (err) => err.name === 'LoginSecurityBlockedError');

    const repo = ds.getRepository(rate.AuthLoginRateLimitEntity);
    const bucket = await repo.findOne({ where: { routeKey: 'admin_login', subjectHash: service.hashSubject('admin_login', 'root_user') } });
    assert.ok(bucket, '哈希桶必须存在');
    assert.equal(bucket.attemptCount, 5, 'attempt_count 应为 5');
    assert.ok(bucket.blockedUntil && bucket.blockedUntil.getTime() > Date.now(), 'blocked_until 应在未来');
    const expectedBlock = Date.now() + 900000;
    assert.ok(Math.abs(bucket.blockedUntil.getTime() - expectedBlock) < 5000, `blocked_until≈now+AUTH_ACCOUNT_BLOCK_MS(900000)，实际偏差=${Math.abs(bucket.blockedUntil.getTime() - expectedBlock)}ms`);

    const failedEvents = await ds.getRepository(evt.AuthSecurityEventEntity).find({ where: { routeKey: 'admin_login', outcome: 'failed' } });
    assert.equal(failedEvents.length, 5, '5 次失败应写 5 条 failed 审计事件');
  } finally {
    await ds.destroy();
  }
});

test('C-04 窗口：超过 AUTH_ACCOUNT_WINDOW_MS 先清零（计数重置为 1），不重复锁定', async () => {
  const rate = compiled('auth/auth-login-rate-limit.entity.js');
  const evt = compiled('auth/auth-security-event.entity.js');
  const { ds, service } = await newService([rate.AuthLoginRateLimitEntity, evt.AuthSecurityEventEntity]);
  try {
    for (let i = 0; i < 4; i += 1) await service.recordFailure(failure('admin_login', 'root_user'));
    const repo = ds.getRepository(rate.AuthLoginRateLimitEntity);
    const bucket = await repo.findOne({ where: { routeKey: 'admin_login', subjectHash: service.hashSubject('admin_login', 'root_user') } });
    bucket.windowStartedAt = new Date(Date.now() - 900000 - 1000); // 模拟窗口已过
    await repo.save(bucket);

    await service.recordFailure(failure('admin_login', 'root_user'));
    const updated = await repo.findOne({ where: { routeKey: 'admin_login', subjectHash: service.hashSubject('admin_login', 'root_user') } });
    assert.equal(updated.attemptCount, 1, '窗口过期后本次失败应重置为 1');
    assert.equal(updated.blockedUntil, null, '窗口重置后不得保留锁定');
    await service.assertAllowed('admin_login', 'root_user'); // 未锁定
  } finally {
    await ds.destroy();
  }
});

test('C-04 成功清桶：recordSuccess 清计数并解除锁定，保留 success 审计事件', async () => {
  const rate = compiled('auth/auth-login-rate-limit.entity.js');
  const evt = compiled('auth/auth-security-event.entity.js');
  const { ds, service } = await newService([rate.AuthLoginRateLimitEntity, evt.AuthSecurityEventEntity]);
  try {
    for (let i = 0; i < 3; i += 1) await service.recordFailure(failure('admin_login', 'root_user'));
    await service.recordSuccess(success('admin_login', 'root_user'));
    await service.assertAllowed('admin_login', 'root_user');
    const repo = ds.getRepository(rate.AuthLoginRateLimitEntity);
    const bucket = await repo.findOne({ where: { routeKey: 'admin_login', subjectHash: service.hashSubject('admin_login', 'root_user') } });
    assert.equal(bucket.attemptCount, 0, '成功后计数必须归零');
    assert.equal(bucket.blockedUntil, null, '成功后必须解除锁定');
    const successEvents = await ds.getRepository(evt.AuthSecurityEventEntity).find({ where: { routeKey: 'admin_login', outcome: 'success' } });
    assert.equal(successEvents.length, 1, '成功应写 1 条 success 审计事件');
  } finally {
    await ds.destroy();
  }
});

test('C-04 并发：DB 事务顺序精确；sqlite 单连接竞争失败关闭(503)不静默；生产路径使用 pessimistic_write', async () => {
  const rate = compiled('auth/auth-login-rate-limit.entity.js');
  const evt = compiled('auth/auth-security-event.entity.js');
  const { ds, service } = await newService([rate.AuthLoginRateLimitEntity, evt.AuthSecurityEventEntity]);
  try {
    const repo = ds.getRepository(rate.AuthLoginRateLimitEntity);
    // (A) 顺序 6 次：DB 读改写计数精确（无丢失）
    for (let i = 0; i < 6; i += 1) await service.recordFailure(failure('admin_login', 'root_user'));
    let bucket = await repo.findOne({ where: { routeKey: 'admin_login', subjectHash: service.hashSubject('admin_login', 'root_user') } });
    assert.equal(bucket.attemptCount, 6, '顺序 6 次失败计数必须精确为 6');
    assert.ok(bucket.blockedUntil && bucket.blockedUntil.getTime() > Date.now(), '达到阈值应锁定');

    // (B) 并发 6 次（不重试）：任何失败必须为 503（失败关闭），不得静默跳过、不得抛其他异常。
    //     说明：TypeORM better-sqlite3 单连接不支持并发写事务，竞争时可能抛 503；
    //     生产 MySQL 由 pessimistic_write/FOR UPDATE 在库内串行化（见 (C) 结构断言）。
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => service.recordFailure(failure('admin_login', 'root_user'))));
    for (const result of results) {
      if (result.status === 'rejected') {
        assert.equal(result.reason.constructor.name, 'ServiceUnavailableException', '并发竞争失败必须为 503（失败关闭）');
        assert.equal(typeof result.reason.getStatus === 'function' ? result.reason.getStatus() : null, 503);
      }
    }
    bucket = await repo.findOne({ where: { routeKey: 'admin_login', subjectHash: service.hashSubject('admin_login', 'root_user') } });
    assert.ok(bucket.attemptCount >= 6, '并发后计数不得低于顺序基线');

    // (C) 结构：非 sqlite 路径必须使用 pessimistic_write（MySQL FOR UPDATE 保证并发不丢更新）
    const serviceJs = fs.readFileSync(path.join(compiledRoot, 'apps', 'api', 'src', 'auth', 'login-security.service.js'), 'utf8');
    assert.match(serviceJs, /pessimistic_write/, 'login-security.service 必须使用 pessimistic_write 锁定');
  } finally {
    await ds.destroy();
  }
});

test('C-04 审计写失败：返回 503 稳定错误码，桶不更新（事务回滚，不静默成功）', async () => {
  const rate = compiled('auth/auth-login-rate-limit.entity.js');
  // 只注册 rate 实体 → auth_security_events 表不存在 → 审计写失败
  const { ds, service } = await newService([rate.AuthLoginRateLimitEntity]);
  try {
    await assert.rejects(
      service.recordFailure(failure('admin_login', 'root_user')),
      (err) => {
        assert.equal(err.constructor.name, 'ServiceUnavailableException', '审计写失败必须抛 503（ServiceUnavailableException）');
        assert.equal(typeof err.getStatus === 'function' ? err.getStatus() : null, 503, '状态码必须为 503');
        return true;
      },
      '审计写失败不得静默成功',
    );
    const repo = ds.getRepository(rate.AuthLoginRateLimitEntity);
    const bucket = await repo.findOne({ where: { routeKey: 'admin_login', subjectHash: service.hashSubject('admin_login', 'root_user') } });
    assert.equal(bucket, null, '审计写失败时桶不得更新（同一事务已回滚）');
  } finally {
    await ds.destroy();
  }
});

test('C-04 敏感信息扫描：审计表只存哈希，无明文 subject/IP/密码/code/token/HMAC key；服务无日志输出', async () => {
  const rate = compiled('auth/auth-login-rate-limit.entity.js');
  const evt = compiled('auth/auth-security-event.entity.js');
  const { ds, service } = await newService([rate.AuthLoginRateLimitEntity, evt.AuthSecurityEventEntity]);
  try {
    const plaintexts = [
      'root_user',               // subject 明文
      '203.0.113.9',             // IP 明文
      'plain-password-123',      // 密码（记录失败不写密码，验证不出现）
      'wx-code-abc123',          // 微信 code
      'invite-token-abc123',     // 邀请 token
      HMAC_TEST_KEY,             // HMAC 密钥
    ];
    for (let i = 0; i < 5; i += 1) await service.recordFailure(failure('admin_login', 'root_user', { ip: '203.0.113.9' }));
    await service.recordBlocked({ route: 'admin_login', subject: 'root_user', context: ctx('203.0.113.9'), outcome: 'blocked', reasonCode: 'ACCOUNT_RATE_BLOCKED' });
    await service.recordSuccess({ route: 'admin_login', subject: 'root_user', context: ctx('203.0.113.9'), outcome: 'success', reasonCode: 'LOGIN_OK', userId: 1, cityId: 2 });

    const events = await ds.getRepository(evt.AuthSecurityEventEntity).find();
    assert.ok(events.length >= 7, '应有 failed 5 + blocked 1 + success 1 审计事件');
    for (const row of events) {
      const serialized = JSON.stringify(row);
      for (const plaintext of plaintexts) {
        assert.ok(!serialized.includes(plaintext), `审计事件不得包含明文: ${plaintext}`);
      }
      assert.match(row.subjectHash, /^[a-f0-9]{64}$/, 'subject_hash 必须是 64 位 hex');
      assert.match(row.ipHash, /^[a-f0-9]{64}$/, 'ip_hash 必须是 64 位 hex');
    }
    // 哈希桶也只存哈希
    const bucket = await ds.getRepository(rate.AuthLoginRateLimitEntity).findOne({ where: { routeKey: 'admin_login', subjectHash: service.hashSubject('admin_login', 'root_user') } });
    const bucketSerialized = JSON.stringify(bucket);
    for (const plaintext of plaintexts) assert.ok(!bucketSerialized.includes(plaintext), `哈希桶不得包含明文: ${plaintext}`);

    // 服务实现不得输出敏感日志
    const serviceJs = fs.readFileSync(path.join(compiledRoot, 'apps', 'api', 'src', 'auth', 'login-security.service.js'), 'utf8');
    assert.ok(!/console\.(log|debug|info|warn|error)\(/.test(serviceJs), 'login-security.service 不得包含 console 输出（防敏感信息日志）');
  } finally {
    await ds.destroy();
  }
});
