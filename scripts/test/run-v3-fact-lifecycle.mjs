import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const apiEntry = process.env.V3_API_ENTRY || path.join(repoRoot, 'apps', 'api', 'dist', 'main.js');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-v3-lifecycle-'));
const database = path.join(tempRoot, 'lifecycle.sqlite');
const fixtureDir = path.join(tempRoot, 'fixtures');
const storageRoot = path.join(tempRoot, 'storage');
let api;
try {
  if (!fs.existsSync(apiEntry)) throw new Error(`V3_API_ENTRY_NOT_FOUND path=${apiEntry}`);
  const migrationEnv = { ...process.env, NODE_ENV: 'test', DB_TYPE: 'sqlite', DB_DATABASE: database, DB_SYNC: 'false' };
  execFileSync(process.execPath, ['scripts/db/migrate.mjs', 'up'], { cwd: repoRoot, env: migrationEnv, stdio: 'inherit' });
  execFileSync(process.execPath, ['scripts/db/migrate.mjs', 'status'], { cwd: repoRoot, env: migrationEnv, stdio: 'inherit' });
  const port = await freePort();
  const apiBase = `http://127.0.0.1:${port}/api`;
  const jwtSecret = randomBytes(48).toString('base64url');
  const authSecurityHmacKey = randomBytes(48).toString('base64url');
  api = spawn(process.execPath, [apiEntry], {
    cwd: repoRoot,
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port), DB_TYPE: 'sqlite', DB_DATABASE: database, DB_SYNC: 'false', FACT_SOURCE_STORAGE_ROOT: storageRoot, JWT_SECRET: jwtSecret, AUTH_SECURITY_HMAC_KEY: authSecurityHmacKey, WECHAT_LOGIN_MODE: 'mock', NODE_PATH: [path.join(repoRoot, 'apps', 'api', 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  api.stdout.on('data', (chunk) => process.stdout.write(`[api] ${chunk}`));
  api.stderr.on('data', (chunk) => process.stderr.write(`[api] ${chunk}`));
  await waitForApi(apiBase, api);
  execFileSync(process.execPath, ['apps/api/test/v3-fact-lifecycle.integration.mjs', database, fixtureDir, apiBase, storageRoot], { cwd: repoRoot, stdio: 'inherit' });
  console.log('V3_FACT_LIFECYCLE_INTEGRATION_OK');
} finally {
  if (api && api.exitCode === null) {
    api.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => api.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 5000))]);
    if (api.exitCode === null) api.kill('SIGKILL');
  }
  fs.rmSync(tempRoot, { recursive: true, force: true });
  console.log(`V3_FACT_LIFECYCLE_CLEANUP_OK root=${tempRoot}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });
}
async function waitForApi(apiBase, child) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API_EXITED code=${child.exitCode}`);
    try { if ((await fetch(apiBase)).ok) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('API_START_TIMEOUT');
}

