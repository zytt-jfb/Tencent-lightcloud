/**
 * B-03 阶段二 · 红测：就绪探针（PG-R10）
 *
 * 覆盖缺陷：旧代码 getReadiness（app.service.ts:36-61）对 DB / 存储直接查询、无超时上限、无结果缓存；
 *           依赖变慢时就绪探针被同步拖慢（可能拖垮健康检查）。
 *
 * 红测语义：断言 = 期望（修复后）行为。旧代码不满足 → 测试失败（exit 1）→ 红。
 *  - liveness 对照（绿）：getLiveness 不触碰依赖（进程存活探针）。
 *  - readiness 红测：DB 查询人为延迟 400ms 时，期望就绪探针在有限超时（<100ms）内给出结论；
 *    旧代码无超时/缓存 → 实测耗时 ≥400ms → 红。
 *
 * 执行：node apps/api/test/readiness.test.mjs（node:test，零新增依赖）
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
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-b03-p2-readiness-'));
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

test('PG-R10 liveness 对照（绿）：getLiveness 不触碰依赖', async () => {
  const { AppService } = compiled('app.service.js');
  let depsTouched = false;
  const service = new AppService(
    { query: async () => { depsTouched = true; return []; } },
    { assertReadable: async () => { depsTouched = true; } },
  );
  const result = service.getLiveness();
  assert.equal(result.status, 'live', 'CONTROL: liveness 应返回 live');
  assert.equal(depsTouched, false, 'CONTROL: liveness 不应触碰依赖');
});

test('E-02 readiness 超时：依赖挂起 > 2s → 约 2s 内返回 503（timeout 稳定码）', async () => {
  const { AppService } = compiled('app.service.js');
  const never = () => new Promise(() => {});
  const service = new AppService(
    { query: async () => { await never(); } },
    { assertReadable: async () => {} },
  );
  const startedAt = Date.now();
  await assert.rejects(
    () => service.getReadiness(),
    (err) => err.constructor.name === 'ServiceUnavailableException' && /timeout|not_ready/.test(JSON.stringify(err.response)),
    'E-02: 依赖挂起应超时并返回 503（not_ready）',
  );
  const elapsedMs = Date.now() - startedAt;
  assert.ok(elapsedMs >= 1800 && elapsedMs < 4000, `E-02: 超时应约 2s（实测 ${elapsedMs}ms）`);
});

test('E-02 readiness 缓存：并发 100 次只触发一次受控依赖检查（5s 缓存）', async () => {
  const { AppService } = compiled('app.service.js');
  let dbChecks = 0;
  let storageChecks = 0;
  const service = new AppService(
    { query: async () => { dbChecks += 1; return []; } },
    { assertReadable: async () => { storageChecks += 1; } },
  );
  const results = await Promise.all(Array.from({ length: 100 }, () => service.getReadiness()));
  assert.ok(results.every((r) => r.status === 'ready'), 'E-02: 并发 100 次应全部 ready');
  assert.equal(dbChecks, 1, `E-02: 5s 缓存内并发只应触发一次 DB 检查，实测 ${dbChecks}`);
  assert.equal(storageChecks, 1, `E-02: 5s 缓存内并发只应触发一次 storage 检查，实测 ${storageChecks}`);
});

test('E-02 readiness 只读：ready 走 assertReadable（不创建探针文件），失败返回 503', async () => {
  const { AppService } = compiled('app.service.js');
  let storageCalls = [];
  const service = new AppService(
    { query: async () => [] },
    { assertReadable: async () => { storageCalls.push('readable'); } },
  );
  await service.getReadiness();
  assert.deepEqual(storageCalls, ['readable'], 'E-02: ready 应只调 assertReadable（只读）');
  // 失败场景：storage 只读失败 → 503
  const failService = new AppService(
    { query: async () => [] },
    { assertReadable: async () => { throw new Error('storage unreadable'); } },
  );
  await assert.rejects(
    () => failService.getReadiness(),
    (err) => err.constructor.name === 'ServiceUnavailableException' && /dependency_error/.test(JSON.stringify(err.response)),
    'E-02: 依赖失败应返回 503（dependency_error 稳定码）',
  );
});
