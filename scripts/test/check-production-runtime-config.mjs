import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import Module from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const apiRoot = path.join(repoRoot, 'apps', 'api');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-runtime-config-'));
const compiledRoot = path.join(tempRoot, 'compiled');
process.env.NODE_PATH = [path.join(apiRoot, 'node_modules'), path.join(repoRoot, 'node_modules'), process.env.NODE_PATH]
  .filter(Boolean).join(path.delimiter);
Module._initPaths();

try {
  const tsc = path.join(repoRoot, 'node_modules', '.pnpm', 'typescript@5.6.3', 'node_modules', 'typescript', 'bin', 'tsc');
  execFileSync(process.execPath, [tsc, '-p', path.join(apiRoot, 'tsconfig.v3-check.json'), '--noEmit', 'false', '--declaration', 'false', '--outDir', compiledRoot, '--pretty', 'false'], { cwd: repoRoot, stdio: 'inherit' });
  const runtime = await import(pathToFileURL(path.join(compiledRoot, 'apps', 'api', 'src', 'runtime.config.js')));
  const jwtSecret = randomBytes(48).toString('base64url');
  const authSecurityHmacKey = randomBytes(48).toString('base64url');
  const valid = {
    NODE_ENV: 'production', DEPLOY_ENV: 'staging', DB_TYPE: 'mysql', DB_HOST: 'mysql.internal', DB_PORT: '3306',
    DB_USERNAME: 'biz_runtime', DB_PASSWORD: 'managed-secret', DB_DATABASE: 'biz_v3', DB_SYNC: 'false',
    JWT_SECRET: jwtSecret, AUTH_SECURITY_HMAC_KEY: authSecurityHmacKey,
    JWT_ISSUER: 'biz-reporting-api', JWT_AUDIENCE: 'biz-reporting-clients',
    TRUST_PROXY_HOPS: '1',
    AUTH_RATE_LIMIT_WINDOW_MS: '60000', AUTH_RATE_LIMIT_IP_MAX: '5',
    AUTH_ACCOUNT_WINDOW_MS: '900000', AUTH_ACCOUNT_MAX_FAILURES: '5', AUTH_ACCOUNT_BLOCK_MS: '900000',
    READINESS_CACHE_MS: '5000', READINESS_TIMEOUT_MS: '2000',
    CORS_ORIGINS: 'https://staging.example.com',
  };
  runtime.validateRuntimeEnvironment(valid);
  for (const [key, value, expected] of [
    ['DB_HOST', '127.0.0.2', /DB_HOST_LOCAL_FORBIDDEN/],
    ['DB_HOST', 'localhost.', /DB_HOST_LOCAL_FORBIDDEN/],
    ['DB_HOST', '::1', /DB_HOST_LOCAL_FORBIDDEN/],
    ['DB_HOST', '0.0.0.0', /DB_HOST_LOCAL_FORBIDDEN/],
    ['DB_PORT', '3306.0', /DB_PORT_INVALID/],
    ['DB_PORT', '0', /DB_PORT_INVALID/],
    ['DB_POOL_CONNECTION_LIMIT', '0', /DB_POOL_CONNECTION_LIMIT_INVALID/],
    ['DB_POOL_CONNECTION_LIMIT', '51', /DB_POOL_CONNECTION_LIMIT_INVALID/],
    ['DB_POOL_QUEUE_LIMIT', '-1', /DB_POOL_QUEUE_LIMIT_INVALID/],
    ['DB_POOL_QUEUE_LIMIT', '10001', /DB_POOL_QUEUE_LIMIT_INVALID/],
    ['CORS_ORIGINS', 'https://127.0.0.2', /CORS_ORIGIN_LOCAL_FORBIDDEN/],
    ['CORS_ORIGINS', 'https://localhost.', /CORS_ORIGIN_LOCAL_FORBIDDEN/],
    ['CORS_ORIGINS', 'https://[::1]', /CORS_ORIGIN_LOCAL_FORBIDDEN/],
    ['CORS_ORIGINS', '*', /CORS_WILDCARD_FORBIDDEN/],
    ['TRUST_PROXY_HOPS', '', /TRUST_PROXY_HOPS_REQUIRED/],
    ['TRUST_PROXY_HOPS', '0', /TRUST_PROXY_HOPS_INVALID/],
    ['TRUST_PROXY_HOPS', '4', /TRUST_PROXY_HOPS_INVALID/],
    ['TRUST_PROXY_HOPS', 'abc', /TRUST_PROXY_HOPS_INVALID/],
    ['TRUST_PROXY_HOPS', '1.5', /TRUST_PROXY_HOPS_INVALID/],
    ['JWT_ISSUER', '', /JWT_ISSUER_REQUIRED/],
    ['JWT_AUDIENCE', '', /JWT_AUDIENCE_REQUIRED/],
    ['AUTH_SECURITY_HMAC_KEY', '', /AUTH_SECURITY_HMAC_KEY_REQUIRED/],
    ['AUTH_SECURITY_HMAC_KEY', valid.JWT_SECRET, /AUTH_SECURITY_HMAC_KEY_MUST_DIFFER_FROM_JWT_SECRET/],
    ['AUTH_RATE_LIMIT_WINDOW_MS', '', /AUTH_RATE_LIMIT_WINDOW_MS_REQUIRED/],
    ['AUTH_RATE_LIMIT_WINDOW_MS', '0', /AUTH_RATE_LIMIT_WINDOW_MS_INVALID/],
    ['AUTH_RATE_LIMIT_IP_MAX', '0', /AUTH_RATE_LIMIT_IP_MAX_INVALID/],
    ['AUTH_ACCOUNT_WINDOW_MS', '-1', /AUTH_ACCOUNT_WINDOW_MS_INVALID/],
    ['AUTH_ACCOUNT_MAX_FAILURES', '1001', /AUTH_ACCOUNT_MAX_FAILURES_INVALID/],
    ['AUTH_ACCOUNT_BLOCK_MS', '0', /AUTH_ACCOUNT_BLOCK_MS_INVALID/],
    ['READINESS_CACHE_MS', '', /READINESS_CACHE_MS_REQUIRED/],
    ['READINESS_CACHE_MS', '0', /READINESS_CACHE_MS_INVALID/],
    ['READINESS_TIMEOUT_MS', '0', /READINESS_TIMEOUT_MS_INVALID/],
    ['READINESS_TIMEOUT_MS', '60001', /READINESS_TIMEOUT_MS_INVALID/],
    ['FACT_SOURCE_STORAGE_ROOT', 'relative/files', /FACT_SOURCE_STORAGE_ROOT_MUST_BE_ABSOLUTE/],
  ]) assert.throws(() => runtime.validateRuntimeEnvironment({ ...valid, [key]: value }), expected);
  console.log('PRODUCTION_RUNTIME_CONFIG_GATE_OK');
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
