import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-facts-v31-'));
const dbPath = path.join(tempRoot, 'facts.sqlite');
const storageRoot = path.join(tempRoot, 'source-files');
const evidenceDir = path.join(tempRoot, 'evidence');
const referenceRoot = process.env.FACT_REFERENCE_ROOT || path.resolve(repoRoot, '..', 'biz-reporting-design-v2', '参考数据');
const node = process.execPath;
const jwtSecret = randomBytes(48).toString('base64url');
let api;

try {
  if (!fs.existsSync(referenceRoot)) throw new Error(`FACT_REFERENCE_ROOT_NOT_FOUND path=${referenceRoot}`);
  const migrationEnv = { ...process.env, NODE_ENV: 'test', DB_TYPE: 'sqlite', DB_DATABASE: dbPath, DB_SYNC: 'false' };
  execFileSync(node, ['scripts/db/migrate.mjs', 'up'], { cwd: repoRoot, env: migrationEnv, stdio: 'inherit' });
  execFileSync(node, ['scripts/db/migrate.mjs', 'status'], { cwd: repoRoot, env: migrationEnv, stdio: 'inherit' });

  const port = await freePort();
  const apiBase = `http://127.0.0.1:${port}/api`;
  api = spawn(node, ['apps/api/dist/main.js'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: 'test', PORT: String(port), DB_TYPE: 'sqlite', DB_DATABASE: dbPath, DB_SYNC: 'false',
      FACT_SOURCE_STORAGE_ROOT: storageRoot, JWT_SECRET: jwtSecret,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  api.stdout.on('data', (chunk) => process.stdout.write(`[api] ${chunk}`));
  api.stderr.on('data', (chunk) => process.stderr.write(`[api] ${chunk}`));
  await waitForApi(apiBase, api);
  execFileSync(node, ['apps/api/test/facts-v31.integration.mjs', dbPath, referenceRoot, evidenceDir, apiBase, storageRoot], {
    cwd: repoRoot, env: process.env, stdio: 'inherit',
  });
  console.log('FACTS_V31_INTEGRATION_OK');
} finally {
  if (api && api.exitCode === null) {
    api.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => api.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 5000))]);
    if (api.exitCode === null) api.kill('SIGKILL');
  }
  fs.rmSync(tempRoot, { recursive: true, force: true });
  console.log(`FACTS_V31_CLEANUP_OK root=${tempRoot}`);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForApi(apiBase, child) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`API_EXITED code=${child.exitCode}`);
    try {
      const response = await fetch(apiBase);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('API_START_TIMEOUT');
}
