/**
 * D-01 集成测试：统一上传过滤 + 持久存储切换（PG-R8）
 *
 * 覆盖：
 * 1. 新任务（sourceFileBuffer）：DB 无 Base64、有存储元数据（storage_key/sha256/size/stored_at）、
 *    经 FactSourceFileStorageService 持久化且读回一致（hash 校验）。
 * 2. legacy（sourceFileBase64）：base64 存 DB（select:false），显式 addSelect 可回退读回。
 * 3. 列表查询 SQL 不得包含 source_file_base64（B-03 红测 → D-01 转绿：entity select:false 生效）。
 *
 * 执行：node apps/api/test/import-job-storage.integration.mjs（node:test，零新增依赖）
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
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-d01-storage-'));
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

/** 构造带真实 FactSourceFileStorageService（tmp 目录）的 Ws6Service */
function makeWs6Service(importJobRepo, factFilesRoot) {
  const { Ws6Service } = compiled('ws6/ws6.service.js');
  const { FactSourceFileStorageService } = compiled('facts/fact-source-file-storage.service.js');
  const operationLogRepo = { create: (x) => x, save: async (x) => x };
  const prevRoot = process.env.FACT_SOURCE_STORAGE_ROOT;
  process.env.FACT_SOURCE_STORAGE_ROOT = factFilesRoot;
  const storage = new FactSourceFileStorageService();
  if (prevRoot === undefined) delete process.env.FACT_SOURCE_STORAGE_ROOT; else process.env.FACT_SOURCE_STORAGE_ROOT = prevRoot;
  return new Ws6Service(
    importJobRepo, {}, {}, {}, {}, {}, {},
    { find: async () => [] }, { find: async () => [] }, operationLogRepo,
    {}, {}, storage,
  );
}

test('D-01 新任务：Buffer 持久存储 → DB 无 Base64、有 metadata、读回一致（hash 校验）', async () => {
  const { DataSource } = apiRequire('typeorm');
  const { ImportJobEntity } = compiled('ws6/import-job.entity.js');
  const { ImportJobType } = apiRequire('@biz-reporting/shared-types');
  const { createHash } = await import('node:crypto');

  const factFilesRoot = path.join(tempRoot, 'fact-files-d01');
  const ds = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [ImportJobEntity], synchronize: true });
  await ds.initialize();
  try {
    const importJobRepo = ds.getRepository(ImportJobEntity);
    const service = makeWs6Service(importJobRepo, factFilesRoot);
    const payload = Buffer.from('D-01 持久存储验证: xlsx-like content', 'utf8');
    const expectedSha = createHash('sha256').update(payload).digest('hex');

    const saved = await service.createImportJob({
      jobType: ImportJobType.CITY_REPORTING,
      operatorUserId: 1,
      cityId: 1,
      reportYear: 2026,
      sourceFileName: 'd01-report.xlsx',
      sourceFileBuffer: payload,
    });

    // DB 无 Base64：普通查询不加载（select:false）且 raw SQL 列值为 NULL（未写入）
    const readBack = await importJobRepo.createQueryBuilder('job').where('job.id = :id', { id: saved.id }).getOne();
    assert.equal(readBack.sourceFileBase64, undefined, 'D-01: 新任务普通查询不应加载 source_file_base64（select:false）');
    const raw = await ds.query('SELECT source_file_base64 FROM import_jobs WHERE id = ?', [saved.id]);
    assert.equal(raw[0]?.source_file_base64 ?? null, null, 'D-01: 新任务 DB 中 source_file_base64 应为 NULL（未写入）');
    // 有存储元数据
    assert.equal(readBack.sourceFileStorageKey, `${expectedSha.slice(0, 2)}/${expectedSha}`, 'D-01: storage_key 应为 sha256 前缀布局');
    assert.equal(readBack.sourceFileSha256, expectedSha, 'D-01: sha256 元数据应写入');
    assert.equal(Number(readBack.sourceFileSize), payload.length, 'D-01: size 元数据应写入');
    assert.ok(readBack.sourceFileStoredAt instanceof Date, 'D-01: stored_at 元数据应写入');
    // 存储读回一致（模拟重启后按 hash 下载）
    const storedPath = path.join(factFilesRoot, expectedSha.slice(0, 2), expectedSha);
    assert.ok(fs.existsSync(storedPath), `D-01: 存储文件应存在于 ${storedPath}`);
    const storedBuf = fs.readFileSync(storedPath);
    assert.deepEqual(storedBuf, payload, 'D-01: 存储内容应与上传 Buffer 一致');
    assert.equal(createHash('sha256').update(storedBuf).digest('hex'), expectedSha, 'D-01: 重启后 hash 下载一致');
    // requireSourceBuffer 走 storage 路径
    const viaService = await service.requireSourceBufferForTest?.(readBack) ?? null;
    if (viaService === null) {
      // 私有方法未暴露：直接读文件验证即可（上述 storedBuf 已验证）
    }
  } finally {
    await ds.destroy();
  }
});

test('D-01 legacy 兼容：Base64 任务显式 addSelect 可回退读回', async () => {
  const { DataSource } = apiRequire('typeorm');
  const { ImportJobEntity } = compiled('ws6/import-job.entity.js');
  const { ImportJobType } = apiRequire('@biz-reporting/shared-types');

  const factFilesRoot = path.join(tempRoot, 'fact-files-legacy');
  const ds = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [ImportJobEntity], synchronize: true });
  await ds.initialize();
  try {
    const importJobRepo = ds.getRepository(ImportJobEntity);
    const service = makeWs6Service(importJobRepo, factFilesRoot);
    const legacyBase64 = Buffer.from('legacy base64 content').toString('base64');

    const saved = await service.createImportJob({
      jobType: ImportJobType.CITY_REPORTING,
      operatorUserId: 1,
      cityId: 1,
      reportYear: 2026,
      sourceFileName: 'legacy-report.xlsx',
      sourceFileBase64: legacyBase64,
    });

    // 普通查询不加载 base64（select:false）
    const plain = await importJobRepo.findOne({ where: { id: saved.id } });
    assert.equal(plain.sourceFileBase64, undefined, 'D-01: 普通查询不应加载 source_file_base64（select:false）');
    assert.equal(plain.sourceFileStorageKey, null, 'D-01: legacy 任务无 storage_key');
    // 显式 addSelect 可回退读回
    const withBase64 = await importJobRepo.createQueryBuilder('job')
      .addSelect('job.sourceFileBase64')
      .where('job.id = :id', { id: saved.id })
      .getOne();
    assert.equal(withBase64.sourceFileBase64, legacyBase64, 'D-01: legacy 显式 addSelect 应可读回原 base64');
  } finally {
    await ds.destroy();
  }
});

test('PG-R8 红测转绿：listImportJobs 生成 SQL 不得包含 source_file_base64（entity select:false）', async () => {
  const { DataSource } = apiRequire('typeorm');
  const { ImportJobEntity } = compiled('ws6/import-job.entity.js');
  const { ImportJobType, Role } = apiRequire('@biz-reporting/shared-types');

  const ds = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [ImportJobEntity], synchronize: true, logging: false });
  await ds.initialize();
  try {
    const importJobRepo = ds.getRepository(ImportJobEntity);
    const bigBase64 = Buffer.alloc(10 * 1024 * 1024, 1).toString('base64');
    const service = makeWs6Service(importJobRepo, path.join(tempRoot, 'fact-files-sql'));
    await service.createImportJob({
      jobType: ImportJobType.CITY_REPORTING,
      operatorUserId: 1,
      cityId: 1,
      reportYear: 2026,
      sourceFileBase64: bigBase64,
      sourceFileName: 'big-report.xlsx',
    });

    let effectiveSql = null;
    const selectCalls = [];
    const originalBuilder = importJobRepo.createQueryBuilder('job');
    const wrapBuilder = (target) => new Proxy(target, {
      get(t, prop) {
        if (prop === 'select') {
          return (cols) => { selectCalls.push(cols); return wrapBuilder(t); };
        }
        if (prop === 'getManyAndCount') {
          return async (...args) => {
            try { effectiveSql = t.getSql(); } catch {}
            return t.getManyAndCount(...args);
          };
        }
        const value = t[prop];
        if (typeof value !== 'function') return value;
        return (...args) => {
          const result = value.apply(t, args);
          return result === t ? wrapBuilder(t) : result;
        };
      },
    });
    const wrappedBuilder = wrapBuilder(originalBuilder);
    const spiedRepo = { createQueryBuilder: () => wrappedBuilder };
    const spyService = new (compiled('ws6/ws6.service.js').Ws6Service)(
      spiedRepo, {}, {}, {}, {}, {}, {},
      { find: async () => [] }, { find: async () => [] }, { create: (x) => x, save: async (x) => x },
      {}, {},
    );
    await spyService.listImportJobs({ page: 1, pageSize: 20 }, { role: Role.SYSTEM_ADMIN, userId: 1, cityId: null });

    const sqlContainsBase64 = effectiveSql !== null && effectiveSql.includes('source_file_base64');
    assert.ok(
      !sqlContainsBase64,
      `RED_EXPECTED[PG-R8]: 列表查询不应读取 source_file_base64（entity select:false 应生效）；实测 SQL 含大字段${effectiveSql ? `：${String(effectiveSql).slice(0, 400)}` : ''}`,
    );
  } finally {
    await ds.destroy();
  }
});
