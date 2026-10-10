/**
 * B-03 阶段二 · 红测：导入列表内存占用（PG-R8）
 *
 * 覆盖缺陷：旧代码 listImportJobs 列表查询不裁剪 source_file_base64 → 10MB Base64 大字段被读入堆内存。
 *
 * 红测语义：断言 = 期望（修复后）行为。旧代码不满足 → 测试失败（exit 1）→ 红。
 *  - 期望：列表查询加载 10MB Base64 job 的堆增量 < 5MB（大字段不入堆）；
 *    旧代码 SELECT 全列 → 实测堆增量 ≈ 13MB+ → 红。
 *  - 附加：生成的 SQL 不得包含 source_file_base64（确定性证据）。
 *
 * 执行：node apps/api/test/import-job-list-memory.mjs（node:test，零新增依赖）
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
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-b03-p2-listmem-'));
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

test('PG-R8 红测：列表查询加载 10MB Base64 作业 → 期望堆增量 <5MB，旧代码大字段入堆 ≈13MB+', async () => {
  const { DataSource } = apiRequire('typeorm');
  const { ImportJobEntity } = compiled('ws6/import-job.entity.js');
  const { ImportJobType, Role } = apiRequire('@biz-reporting/shared-types');
  const { Ws6Service } = compiled('ws6/ws6.service.js');

  const ds = new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [ImportJobEntity], synchronize: true });
  await ds.initialize();
  try {
    const importJobRepo = ds.getRepository(ImportJobEntity);
    const bigBase64 = Buffer.alloc(10 * 1024 * 1024, 1).toString('base64');
    const creator = new Ws6Service(
      importJobRepo, {}, {}, {}, {}, {}, {},
      { find: async () => [] }, { find: async () => [] }, { create: (x) => x, save: async (x) => x },
      {}, {},
    );
    await creator.createImportJob({
      jobType: ImportJobType.CITY_REPORTING,
      operatorUserId: 1,
      cityId: 1,
      reportYear: 2026,
      sourceFileBase64: bigBase64,
      sourceFileName: 'big-report.xlsx',
    });

    let effectiveSql = null;
    let loadedBase64Bytes = 0;
    const originalBuilder = importJobRepo.createQueryBuilder('job');
    const wrapBuilder = (target) => new Proxy(target, {
      get(t, prop) {
        if (prop === 'getManyAndCount') {
          return async (...args) => {
            try { effectiveSql = t.getSql(); } catch {}
            const [jobs] = await t.getManyAndCount(...args);
            loadedBase64Bytes = jobs.reduce((sum, job) => {
              const value = job && job.sourceFileBase64;
              return sum + (typeof value === 'string' ? Buffer.byteLength(value, 'utf8') : 0);
            }, 0);
            return [jobs, jobs.length];
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
    const service = new Ws6Service(
      spiedRepo, {}, {}, {}, {}, {}, {},
      { find: async () => [] }, { find: async () => [] }, { create: (x) => x, save: async (x) => x },
      {}, {},
    );

    const beforeHeap = process.memoryUsage().heapUsed;
    const result = await service.listImportJobs({ page: 1, pageSize: 20 }, { role: Role.SYSTEM_ADMIN, userId: 1, cityId: null });
    const afterHeap = process.memoryUsage().heapUsed;
    const heapDeltaMB = (afterHeap - beforeHeap) / 1024 / 1024;

    const sqlContainsBase64 = effectiveSql !== null && effectiveSql.includes('source_file_base64');
    assert.ok(
      loadedBase64Bytes === 0,
      `RED_EXPECTED[PG-R8]: 列表查询不应把 source_file_base64 读入内存（应显式裁剪列）；旧代码 SELECT 全列 → 实测加载 ${(loadedBase64Bytes / 1048576).toFixed(1)}MB（SQL 含 source_file_base64=${sqlContainsBase64}, items=${result.items.length}, 堆增量=${heapDeltaMB.toFixed(1)}MB）`,
    );
  } finally {
    await ds.destroy();
  }
});
