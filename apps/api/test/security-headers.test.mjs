/**
 * C-03 修复后验证：安全响应头、可信代理、CORS 预检（PG-R5 / PG-R6 / PG-R10）
 *
 * 历史：B-03 阶段二创建本文件作为「基线缺口类」红测——旧代码 main.ts 未启用 helmet、
 *       未关闭 x-powered-by、无可信代理 → 编译产物无安全头中间件 → 红（exit 1）。
 *       C-03 已修复 main.ts（注册 helmet、disable x-powered-by、set trust proxy）→ 本文件转绿。
 *
 * 验证内容：
 *  - 结构断言：main.ts/main.js 存在 helmet 注册、x-powered-by 关闭、trust proxy 设置，且 helmet 先于 CORS。
 *  - HTTP 断言（沙箱 sqlite 模式启动真实 AppModule）：
 *      GET  /api/health/live            → 200，含 helmet 安全头（nosniff / frame / HSTS / CORP），无 x-powered-by
 *      OPTIONS 允许 origin 预检         → Access-Control-Allow-Origin 命中
 *      OPTIONS 拒绝 origin 预检         → 无 Access-Control-Allow-Origin（非通配、非 localhost）
 *
 * 执行：node apps/api/test/security-headers.test.mjs（node:test，零新增依赖）
 */
import { execFileSync, spawn } from 'node:child_process';
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
let bootResult = null;

function compileCurrentSrc() {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-c03-secheaders-'));
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

function pickPort() {
  return 31000 + Math.floor(Math.random() * 2000);
}

async function waitForLive(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health/live`, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return response;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`API_BOOT_TIMEOUT port=${port} lastError=${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

/** 启动编译后的真实 AppModule（沙箱 sqlite 模式），返回 { port, child, stop } */
async function bootSandboxApi() {
  const bootRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-c03-boot-'));
  const database = path.join(bootRoot, 'test.sqlite');
  const storageRoot = path.join(bootRoot, 'storage');
  const entry = path.join(bootRoot, 'entry.cjs');
  const compiledMain = path.join(compiledRoot, 'apps', 'api', 'src', 'main.js');
  fs.writeFileSync(entry, `require('reflect-metadata');\nrequire(${JSON.stringify(compiledMain)});\n`);
  const port = pickPort();
  const env = {
    ...process.env,
    NODE_PATH: [path.join(API_ROOT, 'node_modules'), path.join(REPO_ROOT, 'node_modules'), process.env.NODE_PATH || ''].filter(Boolean).join(path.delimiter),
    NODE_ENV: 'test',
    DB_TYPE: 'sqlite',
    DB_DATABASE: database,
    DB_SYNC: 'true',
    DB_LOGGING: 'false',
    FACT_SOURCE_STORAGE_ROOT: storageRoot,
    TRUST_PROXY_HOPS: '1',
    CORS_ORIGINS: 'https://allowed.example.com',
    JWT_SECRET: 'c03-test-jwt-secret-not-a-real-secret',
    PORT: String(port),
  };
  const child = spawn(process.execPath, [entry], { cwd: bootRoot, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  child.stdout.on('data', () => undefined);
  try {
    await waitForLive(port);
  } catch (error) {
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
    fs.rmSync(bootRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    throw new Error(`${error instanceof Error ? error.message : error}\nCHILD_STDERR:\n${stderr}`);
  }
  return {
    port,
    child,
    stop: async () => {
      child.kill();
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 8000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
      fs.rmSync(bootRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    },
  };
}

before(async () => {
  compileCurrentSrc();
  bootResult = await bootSandboxApi();
});

after(async () => {
  if (bootResult) await bootResult.stop();
  if (tempRoot && fs.existsSync(tempRoot)) {
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
});

test('C-03 结构验证：入口注册 Helmet、关闭 x-powered-by、设置可信代理，且 Helmet 先于 CORS', () => {
  const mainJs = fs.readFileSync(path.join(compiledRoot, 'apps', 'api', 'src', 'main.js'), 'utf8');
  const mainTs = fs.readFileSync(path.join(API_ROOT, 'src', 'main.ts'), 'utf8');

  assert.match(mainTs, /import\s+helmet\s+from\s+['"]helmet['"]/, 'main.ts 应导入 helmet');
  assert.match(mainTs, /app\.use\(helmet\(\{/, 'main.ts 应注册 helmet 中间件');
  assert.match(mainTs, /contentSecurityPolicy:\s*false/, 'helmet 应关闭 CSP（API 场景）');
  assert.match(mainTs, /crossOriginResourcePolicy:\s*\{\s*policy:\s*['"]cross-origin['"]/, 'helmet 应配置跨源资源策略');
  assert.match(mainTs, /disable\(\s*['"]x-powered-by['"]\s*\)/, '应关闭 x-powered-by');
  assert.match(mainTs, /set\(\s*['"]trust proxy['"],\s*Number\(process\.env\.TRUST_PROXY_HOPS\)/, '应设置可信代理跳数');
  const helmetIndex = mainTs.indexOf('helmet');
  const corsIndex = mainTs.indexOf('enableCors');
  assert.ok(helmetIndex !== -1 && corsIndex !== -1 && helmetIndex < corsIndex, 'Helmet 必须在 CORS 之前注册');

  assert.ok(/helmet/i.test(mainJs), '编译产物应包含 helmet 引用');
});

test('C-03 HTTP 验证：GET /api/health/live 返回 helmet 安全头且无 x-powered-by', async () => {
  const response = await fetch(`http://127.0.0.1:${bootResult.port}/api/health/live`);
  assert.equal(response.status, 200, 'live 探针应返回 200');
  const headers = response.headers;
  assert.equal(headers.get('x-content-type-options'), 'nosniff', '应返回 X-Content-Type-Options: nosniff');
  assert.ok(headers.get('x-frame-options'), '应返回 X-Frame-Options');
  assert.ok(headers.get('strict-transport-security'), '应返回 Strict-Transport-Security');
  assert.equal(headers.get('cross-origin-resource-policy'), 'cross-origin', '应返回 Cross-Origin-Resource-Policy: cross-origin');
  assert.equal(headers.get('x-powered-by'), null, '不得返回 x-powered-by');
});

test('C-03 HTTP 验证：CORS 预检只允许精确 HTTPS origin，拒绝陌生 origin', async () => {
  const base = `http://127.0.0.1:${bootResult.port}/api/health/live`;
  const allowed = await fetch(base, {
    method: 'OPTIONS',
    headers: { Origin: 'https://allowed.example.com', 'Access-Control-Request-Method': 'GET' },
  });
  assert.equal(
    allowed.headers.get('access-control-allow-origin'),
    'https://allowed.example.com',
    '允许的 origin 预检应回显 Access-Control-Allow-Origin',
  );

  const denied = await fetch(base, {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example.com', 'Access-Control-Request-Method': 'GET' },
  });
  assert.equal(
    denied.headers.get('access-control-allow-origin'),
    null,
    '陌生 origin 预检不得返回 Access-Control-Allow-Origin',
  );

  const deniedLocalhost = await fetch(base, {
    method: 'OPTIONS',
    headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'GET' },
  });
  assert.equal(
    deniedLocalhost.headers.get('access-control-allow-origin'),
    null,
    'localhost origin 在生产级 CORS 下不得被允许',
  );
});
