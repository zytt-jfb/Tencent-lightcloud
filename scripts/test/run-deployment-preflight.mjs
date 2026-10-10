import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import Module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const apiRoot = path.join(repoRoot, 'apps', 'api');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-deployment-preflight-'));
const compilationRoot = path.join(tempRoot, 'compiled');
const compiledApiRoot = path.join(compilationRoot, 'apps', 'api');
const database = path.join(tempRoot, 'preflight.sqlite');
const storage = path.join(tempRoot, 'fact-source-files');
const jwtSecret = randomBytes(48).toString('base64url');
const authSecurityHmacKey = randomBytes(48).toString('base64url');
const nodePath = [path.join(apiRoot, 'node_modules'), path.join(repoRoot, 'node_modules'), process.env.NODE_PATH]
  .filter(Boolean).join(path.delimiter);
process.env.NODE_PATH = nodePath;
Module._initPaths();

try {
  compileApi();
  const runtime = await import(pathToFileURL(path.join(compiledApiRoot, 'src', 'runtime.config.js')));
  const { AppService } = await import(pathToFileURL(path.join(compiledApiRoot, 'src', 'app.service.js')));
  const validProduction = {
    NODE_ENV: 'production', DEPLOY_ENV: 'staging', DB_TYPE: 'mysql', DB_HOST: 'mysql.internal', DB_PORT: '3306',
    DB_USERNAME: 'biz_runtime', DB_PASSWORD: 'secret-from-manager', DB_DATABASE: 'biz_v3', DB_SYNC: 'false',
    JWT_SECRET: jwtSecret, AUTH_SECURITY_HMAC_KEY: authSecurityHmacKey,
    JWT_ISSUER: 'biz-reporting-api', JWT_AUDIENCE: 'biz-reporting-clients',
    TRUST_PROXY_HOPS: '1',
    AUTH_RATE_LIMIT_WINDOW_MS: '60000', AUTH_RATE_LIMIT_IP_MAX: '5',
    AUTH_ACCOUNT_WINDOW_MS: '900000', AUTH_ACCOUNT_MAX_FAILURES: '5', AUTH_ACCOUNT_BLOCK_MS: '900000',
    READINESS_CACHE_MS: '5000', READINESS_TIMEOUT_MS: '2000',
    CORS_ORIGINS: 'https://staging.example.com',
  };
  assert.equal(runtime.validateRuntimeEnvironment({ ...validProduction }).DB_DATABASE, 'biz_v3');
  for (const [key, value, expected] of [
    ['DB_TYPE', 'sqlite', /DB_TYPE_MYSQL_REQUIRED/], ['DB_HOST', '127.0.0.1', /DB_HOST_LOCAL_FORBIDDEN/],
    ['DB_USERNAME', 'root', /DB_ROOT_USER_FORBIDDEN/], ['DB_PASSWORD', '', /DB_PASSWORD_REQUIRED/],
    ['DB_SYNC', 'true', /DB_SYNC_MUST_BE_FALSE/], ['CORS_ORIGINS', '*', /CORS_WILDCARD_FORBIDDEN/],
    ['CORS_ORIGINS', 'http:\/\/staging.example.com', /CORS_ORIGIN_HTTPS_REQUIRED/],
  ]) assert.throws(() => runtime.validateRuntimeEnvironment({ ...validProduction, [key]: value }), expected);
  console.log('DEPLOYMENT_CONFIG_GATE_OK');

  const migrationEnv = { ...process.env, NODE_ENV: 'test', DB_TYPE: 'sqlite', DB_DATABASE: database, DB_SYNC: 'false' };
  execFileSync(process.execPath, ['scripts/db/migrate.mjs', 'up'], { cwd: repoRoot, env: migrationEnv, stdio: 'inherit' });

  const port = 34000 + Math.floor(Math.random() * 1000);
  const api = startApi({
    NODE_ENV: 'test',
    PORT: String(port),
    DB_TYPE: 'sqlite',
    DB_DATABASE: database,
    DB_SYNC: 'false',
    FACT_SOURCE_STORAGE_ROOT: storage,
    JWT_SECRET: jwtSecret,
    AUTH_SECURITY_HMAC_KEY: authSecurityHmacKey,
    JWT_ISSUER: 'biz-reporting-api',
    JWT_AUDIENCE: 'biz-reporting-clients',
    TRUST_PROXY_HOPS: '1',
    AUTH_RATE_LIMIT_WINDOW_MS: '60000',
    AUTH_RATE_LIMIT_IP_MAX: '5',
    AUTH_ACCOUNT_WINDOW_MS: '900000',
    AUTH_ACCOUNT_MAX_FAILURES: '5',
    AUTH_ACCOUNT_BLOCK_MS: '900000',
    READINESS_CACHE_MS: '5000',
    READINESS_TIMEOUT_MS: '2000',
    CORS_ORIGINS: 'https://staging.example.com',
  });
  let output = '';
  api.stdout.on('data', (chunk) => { output += chunk; });
  api.stderr.on('data', (chunk) => { output += chunk; });
  try {
    const live = await waitForJson(`http://127.0.0.1:${port}/api/health/live`, api, () => output);
    assert.equal(live.status, 'live');
    const ready = await waitForJson(`http://127.0.0.1:${port}/api/health/ready`, api, () => output);
    assert.equal(ready.status, 'ready');
    assert.deepEqual(ready.checks, { database: 'up', storage: 'up' });
    const root = await waitForJson(`http://127.0.0.1:${port}/api`, api, () => output);
    assert.equal(root.status, 'live');
    console.log('DEPLOYMENT_HEALTH_PROBES_OK');
  } finally {
    api.kill('SIGTERM');
    await waitForExit(api, 5000);
  }
  assert.match(output, /API_SHUTDOWN_HOOKS_ENABLED/);
  console.log('DEPLOYMENT_GRACEFUL_SHUTDOWN_OK');

  await expectNotReady(AppService, async () => { throw new Error('DATABASE_DISCONNECTED'); }, async () => undefined, { database: 'dependency_error', storage: 'up' });
  console.log('DEPLOYMENT_DATABASE_READINESS_REJECTED');
  await expectNotReady(AppService, async () => undefined, async () => { throw new Error('STORAGE_UNAVAILABLE'); }, { database: 'up', storage: 'dependency_error' });
  console.log('DEPLOYMENT_STORAGE_READINESS_REJECTED');

  await assertStartupFailure('DEPLOYMENT_INVALID_PRODUCTION_STARTUP_REJECTED', {
    NODE_ENV: 'production', DEPLOY_ENV: 'staging', PORT: '0', DB_TYPE: 'sqlite', DB_DATABASE: database,
    DB_SYNC: 'false', FACT_SOURCE_STORAGE_ROOT: storage, JWT_SECRET: jwtSecret, AUTH_SECURITY_HMAC_KEY: authSecurityHmacKey,
    JWT_ISSUER: 'biz-reporting-api', JWT_AUDIENCE: 'biz-reporting-clients', TRUST_PROXY_HOPS: '1',
    AUTH_RATE_LIMIT_WINDOW_MS: '60000', AUTH_RATE_LIMIT_IP_MAX: '5', AUTH_ACCOUNT_WINDOW_MS: '900000',
    AUTH_ACCOUNT_MAX_FAILURES: '5', AUTH_ACCOUNT_BLOCK_MS: '900000', READINESS_CACHE_MS: '5000',
    READINESS_TIMEOUT_MS: '2000', CORS_ORIGINS: 'https://staging.example.com',
  }, /DB_TYPE_MYSQL_REQUIRED/);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

function compileApi() {
  const tsc = path.join(repoRoot, 'node_modules', '.pnpm', 'typescript@5.6.3', 'node_modules', 'typescript', 'bin', 'tsc');
  execFileSync(process.execPath, [tsc, '-p', path.join(apiRoot, 'tsconfig.v3-check.json'), '--noEmit', 'false', '--declaration', 'false', '--outDir', compilationRoot, '--pretty', 'false'], { cwd: repoRoot, stdio: 'inherit' });
}

function startApi(environment) {
  const child = spawn(process.execPath, ['src/main.js'], { cwd: compiledApiRoot, env: { ...process.env, ...environment, NODE_PATH: nodePath }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.on('error', (error) => child.stderr.emit('data', Buffer.from(`API_SPAWN_ERROR ${error.message}`)));
  return child;
}

async function expectNotReady(AppService, query, assertReadable, checks) {
  const service = new AppService({ query }, { assertReadable });
  await assert.rejects(service.getReadiness(), (error) => {
    assert.equal(error.getStatus(), 503);
    assert.deepEqual(error.getResponse().checks, checks);
    return true;
  });
}

async function assertStartupFailure(label, environment, expected) {
  const child = startApi(environment);
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  try {
    const exitCode = await waitForExit(child, 10000);
    assert.notEqual(exitCode, 0);
    assert.match(output, expected);
    console.log(label);
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await waitForExit(child, 5000).catch(() => undefined);
    }
  }
}

async function waitForJson(url, child, output) {
  for (let attempt = 0; attempt < 300; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`API_EXITED code=${child.exitCode} output=${output()}`);
    try { const response = await fetch(url); if (response.ok) return response.json(); } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`API_TIMEOUT url=${url} output=${output()}`);
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null) return Promise.resolve(child.exitCode);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`PROCESS_EXIT_TIMEOUT pid=${child.pid}`)), timeoutMs);
    child.once('exit', (code) => { clearTimeout(timer); resolve(code); });
  });
}
