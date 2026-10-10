/**
 * D-06 测试：旧 Base64 文件迁移工具（dry-run / apply / re-run / 故障注入 / hash 不一致）
 *
 * 执行：node scripts/test/migrate-import-job-files.test.mjs（node:test，零新增依赖）
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { test, before, after } from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const require = createRequire(path.join(REPO_ROOT, 'apps/api/package.json'));
const Database = require('better-sqlite3');

const TOOL = path.join(REPO_ROOT, 'scripts/oneoff/migrate-import-job-files.mjs');
let tempRoot;
let dbPath;
let storageRoot;

function createDb(jobs) {
  if (fs.existsSync(dbPath)) fs.rmSync(dbPath, { force: true });
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE import_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_type VARCHAR(32) NOT NULL,
      operator_user_id BIGINT NOT NULL,
      city_id BIGINT NULL,
      status VARCHAR(32) NOT NULL,
      source_file_url VARCHAR(500) NOT NULL DEFAULT '',
      source_file_base64 TEXT NULL,
      source_file_name VARCHAR(255) NULL,
      source_file_storage_key VARCHAR(500) NULL,
      source_file_sha256 VARCHAR(64) NULL,
      source_file_size BIGINT NULL,
      source_file_stored_at DATETIME NULL,
      attempt_count INT NOT NULL DEFAULT 0,
      processing_started_at DATETIME NULL,
      failure_code VARCHAR(64) NULL
    );
  `);
  const insert = db.prepare(`INSERT INTO import_jobs
    (job_type, operator_user_id, city_id, status, source_file_base64, source_file_sha256, source_file_storage_key)
    VALUES (@jobType, @operator, @city, 'pending', @base64, @sha256, @storageKey)`);
  for (const job of jobs) insert.run(job);
  db.close();
}

function runTool(extraArgs = []) {
  return spawnSync(process.execPath, [TOOL, '--db', dbPath, '--storage-root', storageRoot, ...extraArgs], {
    encoding: 'utf8',
    timeout: 30_000,
  });
}

before(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-d06-migrate-'));
  dbPath = path.join(tempRoot, `biz-migrate-${Date.now()}.sqlite`);
  storageRoot = path.join(tempRoot, 'fact-files');
});

after(async () => {
  if (tempRoot && fs.existsSync(tempRoot)) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        fs.rmSync(tempRoot, { recursive: true, force: true });
        break;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
  }
});

test('D-06 dry-run：只报告不写入（存储文件与 DB 均不变）', () => {
  createDb([
    { jobType: 'city_reporting', operator: 1, city: 1, base64: Buffer.from('content-A').toString('base64'), sha256: null, storageKey: null },
    { jobType: 'city_reporting', operator: 1, city: 1, base64: Buffer.from('content-B').toString('base64'), sha256: null, storageKey: null },
  ]);
  const r = runTool();
  assert.equal(r.status, 0, `dry-run exit 0；stderr=${r.stderr}`);
  assert.match(r.stdout, /mode=dry-run/);
  assert.match(r.stdout, /migrated=2/);
  assert.match(r.stdout, /DRY_RUN_PREVIEW/);
  // 存储目录未创建
  assert.equal(fs.existsSync(storageRoot), false, 'dry-run 不应写存储文件');
  // DB 未更新（storage_key 仍 NULL）
  const db = new Database(dbPath, { readonly: true });
  const keys = db.prepare('SELECT source_file_storage_key FROM import_jobs').all().map((r2) => r2.source_file_storage_key);
  db.close();
  assert.deepEqual(keys, [null, null], 'dry-run 不应更新 DB metadata');
});

test('D-06 apply 缺 --env-id → exit 2 硬失败', () => {
  const r = runTool(['--apply']);
  assert.notEqual(r.status, 0);
  assert.equal(r.status, 2, '缺 --env-id 应 exit 2');
  assert.match(r.stdout + r.stderr, /--env-id/);
});

test('D-06 apply --env-id 不匹配 → exit 2 拒绝写入', () => {
  const r = runTool(['--apply', '--env-id', 'wrong-token']);
  assert.equal(r.status, 2);
  assert.match(r.stdout + r.stderr, /不匹配/);
});

test('D-06 apply：写存储 + 更新 metadata；re-run 幂等跳过', () => {
  const payload = Buffer.from('apply-content-XYZ');
  const sha256 = require('node:crypto').createHash('sha256').update(payload).digest('hex');
  createDb([
    { jobType: 'city_reporting', operator: 1, city: 1, base64: payload.toString('base64'), sha256: null, storageKey: null },
  ]);
  const envId = path.basename(dbPath).replace('.sqlite', '');
  const r = runTool(['--apply', '--env-id', envId]);
  assert.equal(r.status, 0, `apply exit 0；stderr=${r.stderr}`);
  assert.match(r.stdout, /mode=apply/);
  assert.match(r.stdout, /migrated=1/);
  // 存储文件存在
  const key = `${sha256.slice(0, 2)}/${sha256}`;
  assert.ok(fs.existsSync(path.join(storageRoot, key)), '存储文件应写入');
  assert.deepEqual(fs.readFileSync(path.join(storageRoot, key)), payload, '存储内容一致');
  // DB metadata 更新
  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare('SELECT source_file_storage_key, source_file_sha256, source_file_size FROM import_jobs WHERE id=1').get();
  db.close();
  assert.equal(row.source_file_storage_key, key);
  assert.equal(row.source_file_sha256, sha256);
  assert.equal(Number(row.source_file_size), payload.length);
  // re-run 幂等：已迁移 → skipped，不重复写
  const r2 = runTool(['--apply', '--env-id', envId]);
  assert.equal(r2.status, 0);
  assert.match(r2.stdout, /skipped=1/);
  assert.match(r2.stdout, /migrated=0/);
});

test('D-06 故障注入：hash 不一致 → failed HASH_MISMATCH 且保留 Base64', () => {
  createDb([
    { jobType: 'city_reporting', operator: 1, city: 1, base64: Buffer.from('content-C').toString('base64'), sha256: 'a'.repeat(64), storageKey: null },
  ]);
  const r = runTool();
  assert.equal(r.status, 1, 'hash 不一致应 exit 1');
  assert.match(r.stdout, /failed=1/);
  assert.match(r.stdout, /HASH_MISMATCH/);
  assert.match(r.stdout, /FAILED_DETAILS/);
  // Base64 保留
  const db = new Database(dbPath, { readonly: true });
  const row = db.prepare('SELECT source_file_base64 FROM import_jobs WHERE id=1').get();
  db.close();
  assert.ok(row.source_file_base64.length > 0, '失败任务应保留 Base64');
});

test('D-06 幂等：已迁移（storage_key 非空）任务跳过', () => {
  createDb([
    { jobType: 'city_reporting', operator: 1, city: 1, base64: null, sha256: 'b'.repeat(64), storageKey: 'bb/bbbbbbbb' },
  ]);
  const r = runTool();
  assert.equal(r.status, 0);
  assert.match(r.stdout, /skipped=1/);
  assert.match(r.stdout, /already_migrated/);
});
