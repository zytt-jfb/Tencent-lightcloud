/**
 * E-03 测试：request ID 中间件 + 脱敏结构化 HTTP 日志
 *
 * 覆盖：
 * 1. RequestIdMiddleware：合法传入保留、非法字符剔除截断、缺失生成；响应 X-Request-Id 回传。
 * 2. HttpLoggingInterceptor：日志字段白名单（method/route/status/duration/requestId/userId/cityId）；
 *    body/header/query/openid/name/password/token 不出日志（敏感词与伪 token 扫描为零）。
 * 3. 异常路径同样记录（含 requestId）。
 *
 * 执行：node apps/api/test/http-logging.test.mjs（node:test，零新增依赖）
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test, before, after } from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const API_ROOT = path.join(REPO_ROOT, 'apps', 'api');
const apiRequire = createRequire(path.join(API_ROOT, 'package.json'));

let compiledRoot = null;
let tempRoot = null;

function compileCurrentSrc() {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-e03-http-'));
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

test('E-03 RequestIdMiddleware：合法保留/非法剔除/缺失生成 + X-Request-Id 回传', () => {
  const { RequestIdMiddleware, MAX_REQUEST_ID_LENGTH } = compiled('common/http/request-id.middleware.js');
  const mw = new RequestIdMiddleware();
  const run = (headerValue) => {
    const req = { headers: headerValue === undefined ? {} : { 'x-request-id': headerValue } };
    const res = { setHeader: () => {} };
    let nextCalled = false;
    mw.use(req, res, () => { nextCalled = true; });
    return { requestId: req.requestId, nextCalled };
  };
  // 合法传入保留
  const ok = run('abc-123.xyz_9');
  assert.equal(ok.requestId, 'abc-123.xyz_9');
  assert.ok(ok.nextCalled);
  // 非法字符剔除
  const dirty = run('bad"chars/<>|@#\n\n\n');
  assert.equal(dirty.requestId, 'badchars');
  // 缺失生成 req- 前缀
  const generated = run(undefined);
  assert.match(generated.requestId, /^req-[A-Za-z0-9-]{1,32}$/);
  // 超长截断 64
  const long = run('a'.repeat(100));
  assert.ok(long.requestId.length <= MAX_REQUEST_ID_LENGTH);
});

test('E-03 HttpLoggingInterceptor：日志字段白名单 + 敏感词/伪 token 零输出 + 异常路径有 requestId', async () => {
  const { HttpLoggingInterceptor } = compiled('common/http/http-logging.interceptor.js');
  const { of, throwError } = apiRequire('rxjs');

  const lines = [];
  const origLog = console.log;
  console.log = (line) => { lines.push(line); };

  try {
    const makeCtx = (req, res, _stream) => ({
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
      getClass: () => ({}),
      getHandler: () => ({}),
    });
    const interceptor = new HttpLoggingInterceptor();

    // 成功路径
    const successReq = {
      method: 'POST',
      baseUrl: '', path: '/api/auth/admin/login', route: { path: '/api/auth/admin/login' },
      requestId: 'req-test-123',
      headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.fake', cookie: 'session=abc' },
      body: { username: 'root', password: 'SuperSecret123!' },
      query: { token: 'query-token', openid: 'oABC123' },
      user: { userId: 7, cityId: 5 },
    };
    await new Promise((resolve) => {
      interceptor.intercept(makeCtx(successReq, { statusCode: 200 }, of('ok')), { handle: () => of('ok') }).subscribe(() => resolve());
    });
    // 异常路径
    await new Promise((resolve) => {
      interceptor.intercept(
        makeCtx({ ...successReq, requestId: 'req-err-999' }, { statusCode: 500 }, throwError(() => new Error('boom'))),
        { handle: () => throwError(() => new Error('boom')) },
      ).subscribe({ error: () => resolve() });
    });

    // 两条日志
    assert.equal(lines.length, 2, `E-03: 应记录 2 条日志（成功+异常），实测 ${lines.length}`);
    const parsed = lines.map((l) => JSON.parse(l));
    // 字段白名单
    for (const entry of parsed) {
      const keys = Object.keys(entry);
      for (const key of keys) {
        assert.ok(
          ['type', 'requestId', 'method', 'route', 'status', 'durationMs', 'userId', 'cityId', 'timestamp'].includes(key),
          `E-03: 日志字段超出白名单：${key}`,
        );
      }
    }
    // 异常路径有 requestId
    assert.ok(parsed.some((e) => e.requestId === 'req-err-999' && e.status === 500), 'E-03: 异常路径应记录 requestId');
    // 敏感词与伪 token 扫描为零
    const logText = JSON.stringify(lines);
    for (const sensitive of ['openid', 'password', 'SuperSecret', 'query-token', 'Bearer', 'session', 'authorization', 'cookie', 'username']) {
      assert.ok(!logText.includes(sensitive), `E-03: 日志不应包含敏感内容 ${sensitive}`);
    }
  } finally {
    console.log = origLog;
  }
});
