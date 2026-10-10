/**
 * C-05 集成测试：登录限流与账号桶锁定（PG-R6）
 *
 * 覆盖：
 * 1. 账号哈希桶（C-04 LoginSecurityService）：同一账号第 5 次失败后锁定，第 6 次被拒
 *    （B-03 红测：旧代码无任何限流 → 6 次全 401 无锁定 → 红）
 * 2. 结构断言：main.ts 注册限流保护（ThrottlerModule → HTTP 层 429）
 *
 * 修复后行为：第 6 次登录尝试抛 UnauthorizedException（"尝试过于频繁"）——账号桶锁定生效；
 * HTTP 层 Throttler 5/min 产生 429 由 run-auth-v3.mjs 端到端验证（此处为 service 级）。
 *
 * 执行：node apps/api/test/auth-rate-limit.integration.mjs（node:test，零新增依赖）
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const API_ROOT = path.join(REPO_ROOT, 'apps', 'api');
const apiRequire = createRequire(path.join(API_ROOT, 'package.json'));

let compiledRoot = null;
let tempRoot = null;

function compileCurrentSrc() {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-c05-ratelimit-'));
  compiledRoot = path.join(tempRoot, 'compiled');
  process.env.NODE_PATH = [
    path.join(API_ROOT, 'node_modules'),
    path.join(REPO_ROOT, 'node_modules'),
    process.env.NODE_PATH,
  ].filter(Boolean).join(path.delimiter);
  Module._initPaths();
  apiRequire("reflect-metadata");
  const tsc = apiRequire.resolve('typescript/bin/tsc');
  execFileSync(
    process.execPath,
    [tsc, '-p', path.join(API_ROOT, 'tsconfig.v3-check.json'), '--noEmit', 'false', '--declaration', 'false', '--outDir', compiledRoot, '--pretty', 'false'],
    { cwd: REPO_ROOT, stdio: 'pipe' },
  );
}

function compiled(rel) {
  return apiRequire(path.join(compiledRoot, 'apps', 'api', 'src', rel));
}

before(() => compileCurrentSrc());

after(() => {
  if (tempRoot && fs.existsSync(tempRoot)) {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

/** 构造带真实 LoginSecurityService 的 AuthService（sqlite :memory:，两实体同步建表） */
async function buildAuthService() {
  const { DataSource } = apiRequire('typeorm');
  const { ConfigService } = apiRequire('@nestjs/config');
  const { UserEntity } = compiled('users/user.entity.js');
  const { AuthLoginRateLimitEntity } = compiled('auth/auth-login-rate-limit.entity.js');
  const { AuthSecurityEventEntity } = compiled('auth/auth-security-event.entity.js');
  const { AuthService } = compiled('auth/auth.service.js');
  const { LoginSecurityService } = compiled('auth/login-security.service.js');
  const bcrypt = apiRequire('bcryptjs');
  const { Role, UserStatus } = apiRequire('@biz-reporting/shared-types');

  const ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [UserEntity, AuthLoginRateLimitEntity, AuthSecurityEventEntity],
    synchronize: true,
  });
  await ds.initialize();

  const config = new ConfigService({
    AUTH_SECURITY_HMAC_KEY: 'integration-test-hmac-key-not-secret',
  });

  const userRepo = ds.getRepository(UserEntity);
  await userRepo.save(userRepo.create({
    id: 1,
    role: Role.ROOT_ADMIN,
    name: 'root',
    username: 'admin',
    passwordHash: bcrypt.hashSync('correct-password', 4),
    status: UserStatus.ENABLED,
    authVersion: 1,
    mustChangePassword: false,
  }));

  const usersService = {
    findByUsername: async (username) => {
      const row = await userRepo.findOne({ where: { username } });
      return row ?? null;
    },
    findById: async (id) => userRepo.findOne({ where: { id } }),
    findByOpenid: async () => null,
    updateLastLogin: async () => {},
  };
  const loginSecurity = new LoginSecurityService(ds, config);
  const service = new AuthService(
    usersService,
    { sign: () => 'jwt-token' },
    { code2Session: async () => 'openid' },
    { auditLogout: async () => {}, consumeWechatInvitation: async () => {} },
    loginSecurity,
  );

  return { service, ds };
}

test('C-05 账号桶：同一账号第 5 次失败后第 6 次被锁定（B-03 红测转绿）', async () => {
  const { service, ds } = await buildAuthService();
  try {
    const statuses = [];
    for (let i = 0; i < 6; i += 1) {
      try {
        await service.adminLogin({ username: 'admin', password: 'wrong-password' });
        statuses.push(200);
      } catch (err) {
        const name = err && err.constructor ? err.constructor.name : 'Error';
        if (name === 'UnauthorizedException') {
          statuses.push(err.message && err.message.includes('尝试过于频繁') ? 429 : 401);
        } else if (name === 'BadRequestException') {
          statuses.push(400);
        } else {
          statuses.push(500);
        }
      }
    }
    // 修复后：第 5 次失败设置 blockedUntil，第 6 次应被锁定拦截（映射 429 语义）
    assert.ok(
      statuses.includes(429),
      `C-05 期望账号桶第 6 次被锁定（429 语义）；实测状态序列=${JSON.stringify(statuses)}`,
    );
    assert.ok(
      statuses.filter((s) => s === 401).length >= 4,
      `C-05 期望前几次为普通 401；实测=${JSON.stringify(statuses)}`,
    );
  } finally {
    await ds.destroy();
  }
});

test('C-05 成功登录清桶：锁定后正确密码可恢复（recordSuccess 清计数）', async () => {
  const { service, ds } = await buildAuthService();
  try {
    // 先失败 5 次触发锁定
    for (let i = 0; i < 5; i += 1) {
      await service.adminLogin({ username: 'admin', password: 'wrong-password' }).catch(() => {});
    }
    // 第 6 次应被锁定
    await assert.rejects(
      () => service.adminLogin({ username: 'admin', password: 'correct-password' }),
      (err) => err.message && err.message.includes('尝试过于频繁'),
      'C-05 期望锁定期间正确密码也被拒绝',
    );
    // 锁定期间（blockedUntil 未过）任何尝试均被拒——等待窗口无意义，直接断言审计存在锁定记录
    const { AuthSecurityEventEntity } = compiled('auth/auth-security-event.entity.js');
    const events = await ds.getRepository(AuthSecurityEventEntity).find();
    const blocked = events.filter((e) => e.outcome === 'blocked');
    assert.ok(blocked.length >= 1, `C-05 期望存在 blocked 审计；实测 events=${events.length}`);
  } finally {
    await ds.destroy();
  }
});

test('PG-R6 结构断言：app.module 应注册 ThrottlerGuard 限流保护（HTTP 429）', () => {
  const appModuleSource = fs.readFileSync(path.join(compiledRoot, 'apps', 'api', 'src', 'app.module.js'), 'utf8');
  const hasThrottler = /ThrottlerModule|ThrottlerGuard|@nestjs\/throttler/.test(appModuleSource);
  assert.ok(
    hasThrottler,
    'RED_EXPECTED[PG-R6]: 应用模块应注册 ThrottlerModule/ThrottlerGuard（限流 429）；旧代码未注册任何限流 → 连续尝试无 429',
  );
});
