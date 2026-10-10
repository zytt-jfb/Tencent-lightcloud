/**
 * B-03 阶段二 · 红测：并发/唯一约束（IMP-1 P1）
 *
 * 覆盖缺陷：
 *  - IMP-1 三张月表 TypeORM 实体缺 @Unique（contract-month-row.entity.ts:5-8、cost-month-row.entity.ts:5-8、
 *    maintenance-month-row.entity.ts:5-8 注释声称唯一约束但无装饰器；仅 DDL 有唯一键），
 *    且 findOne-then-write 非原子（reporting-import.service.ts:259-282 等）。
 *    后果：① synchronize:true 环境根本不建唯一键 → 并发双写产生重复行；② 并发确认同一 job 不幂等。
 *
 * 红测语义：断言 = 期望（修复后）行为。旧代码不满足 → 测试失败（exit 1）→ 红。
 *  - 结构：三张月表实体元数据应注册唯一约束（@Unique 或 unique column）；旧代码 uniques=0 → 红。
 *  - 行为：两个并发 execute 写入同一 package+contract+month → 期望幂等（1 行）；旧代码无唯一键 → 2 行 → 红。
 *  - 作业：两个并发 confirmImport 确认同一 job → 期望幂等（仅一次 execute）；旧代码 findOne-then-write 非原子 → 两次 → 红。
 *
 * 执行：node apps/api/test/import-job-concurrency.integration.mjs（node:test，零新增依赖）
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
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-b03-p2-concurrency-'));
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

// IMP-1 结构验证（F-01 纠偏令启用）：三张月表实体已补 @Unique，与 001 DDL 键名一致。
test('IMP-1 结构：三张月表实体元数据应注册唯一约束（F-01 纠偏令修复：@Unique 与 001 DDL 完全一致）', () => {
  const { getMetadataArgsStorage } = apiRequire('typeorm');
  const storage = getMetadataArgsStorage();
  const { ContractMonthRowEntity } = compiled('packages/contract-month-row.entity.js');
  const { CostMonthRowEntity } = compiled('packages/cost-month-row.entity.js');
  const { MaintenanceMonthRowEntity } = compiled('packages/maintenance-month-row.entity.js');

  const expectedUniques = {
    ContractMonthRowEntity: 'uk_contract_rows_pkg_code_month',
    CostMonthRowEntity: 'uk_cost_rows_pkg_month_cat',
    MaintenanceMonthRowEntity: 'uk_maintenance_rows_pkg_month',
  };
  for (const [name, EntityClass] of [
    ['ContractMonthRowEntity', ContractMonthRowEntity],
    ['CostMonthRowEntity', CostMonthRowEntity],
    ['MaintenanceMonthRowEntity', MaintenanceMonthRowEntity],
  ]) {
    const classUniques = storage.uniques.filter((u) => u.target === EntityClass);
    assert.ok(
      classUniques.length > 0,
      `IMP-1[结构]: ${name} 应声明 @Unique（F-01 修复后实体含唯一约束；旧代码仅注释声称 → uniques=0）`,
    );
    assert.equal(
      classUniques[0].name,
      expectedUniques[name],
      `IMP-1[结构]: ${name} 的 @Unique 名应与 001 DDL ${expectedUniques[name]} 一致，实测 ${classUniques[0].name}`,
    );
  }
});

function makeReportingXlsx() {
  const XLSX = apiRequire('xlsx');
  const ws1Data = [
    ['地市', '合同名称', '合同编码', '备注', '单位', '1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月', '合计'],
    ['单位：万元', '', '', '', '', null, null, null, null, null, null, null, null, null, null, null, null, null],
    ['济南', '合同甲', 'C001', '', '', 100, 100, null, null, null, null, null, null, null, null, null, null, null],
  ];
  const ws2Data = [
    ['类别', '1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
    ['人工成本', 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ws1Data), '合同订单-济南');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ws2Data), '成本测算-济南');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// IMP-1 行为验证（F-01 纠偏令启用）：并发 execute 写入同一 package+contract+month → 原子 upsert 幂等 1 行。
// 修复后 reporting-import.service.ts 使用事务内 upsert（依赖实体 @Unique），并发不同 job 写同一业务键
// 由唯一约束 ON CONFLICT 吸收，不产生重复行、不 500。
test('IMP-1 行为：并发 execute 写入同一 package+contract+month → 原子 upsert 幂等 1 行（F-01 修复实证）', async () => {
  const { DataSource } = apiRequire('typeorm');
  const { SoftDeleteFlag } = apiRequire('@biz-reporting/shared-types');
  const { CityEntity } = compiled('cities/city.entity.js');
  const { ContractEntity } = compiled('contracts/contract.entity.js');
  const { AllocationEntity } = compiled('contracts/allocation.entity.js');
  const { AnnualPackageEntity } = compiled('packages/annual-package.entity.js');
  const { ContractMonthRowEntity } = compiled('packages/contract-month-row.entity.js');
  const { CostMonthRowEntity } = compiled('packages/cost-month-row.entity.js');
  const { MaintenanceMonthRowEntity } = compiled('packages/maintenance-month-row.entity.js');
  const { ReportingImportService, ReportingImportScope } = compiled('ws6/reporting-import.service.js');

  const ds = new DataSource({
    type: 'better-sqlite3', database: ':memory:', synchronize: true,
    entities: [CityEntity, ContractEntity, AllocationEntity, AnnualPackageEntity, ContractMonthRowEntity, CostMonthRowEntity, MaintenanceMonthRowEntity],
  });
  await ds.initialize();
  try {

    const cityRepo = ds.getRepository(CityEntity);
    const contractRepo = ds.getRepository(ContractEntity);
    const allocRepo = ds.getRepository(AllocationEntity);
    await cityRepo.save(cityRepo.create({ id: 1, name: '济南', code: '370100', sortOrder: 1 }));
    await contractRepo.save(contractRepo.create({ id: 1, contractCode: 'C001', contractName: '合同甲', isDeleted: SoftDeleteFlag.NOT_DELETED, rate: 0.05, contractAmount: 100, createdBy: 1, updatedBy: 1 }));
    await allocRepo.save(allocRepo.create({ id: 1, contractId: 1, cityId: 1, cityContractAmount: 100, rate: 0.05 }));

    // 真实事务 manager（synchronize 已按实体 @Unique 建唯一键；upsert 走 ON CONFLICT 原子路径）
    const dataSource = {
      getRepository: (entity) => ds.getRepository(entity),
      transaction: async (cb) => cb(ds.manager),
    };
    const service = new ReportingImportService(contractRepo, cityRepo, dataSource);
    const buf = makeReportingXlsx();
    // 两个"job"并发写同一业务键：第一次插入、第二次 ON CONFLICT DO UPDATE → 始终 1 行
    const results = await Promise.allSettled([
      service.execute(buf, 2026, 1, 'reporting-济南.xlsx', null, ReportingImportScope.ALL),
      service.execute(buf, 2026, 1, 'reporting-济南.xlsx', null, ReportingImportScope.ALL),
    ]);
    const rejected = results.filter((r) => r.status === 'rejected');
    assert.equal(
      rejected.length,
      0,
      `IMP-1[行为]: 并发 execute 不得 500/异常（upsert 原子吸收唯一冲突）；实测 rejected=${rejected.length}: ${JSON.stringify(rejected.map((r) => String(r.reason)))}`,
    );
    const rows = await ds.getRepository(ContractMonthRowEntity).count();
    assert.equal(
      rows,
      1,
      `IMP-1[行为]: 并发写入同一 package+contract+month 应幂等 1 行（原子 upsert）；实测 ${rows} 行（旧代码 findOne-then-write 非原子 → 双写）`,
    );
  } finally {
    await ds.destroy();
  }
});

test('D-04 作业并发互斥：并发 confirmImport 确认同一 job → 原子 CAS 仅一次 execute（B-03 IMP-1 红测转绿）', async () => {
  const { Ws6Service } = compiled('ws6/ws6.service.js');
  const { ImportJobType, JobStatus, Role } = apiRequire('@biz-reporting/shared-types');

  let executeCalls = 0;
  let claimed = false;
  const job = {
    id: 9,
    jobType: ImportJobType.CITY_REPORTING,
    operatorUserId: 1,
    cityId: 1,
    reportYear: 2026,
    status: JobStatus.PENDING,
    sourceFileUrl: '/api/imports/9/source-file',
    sourceFileBase64: Buffer.from('xlsx-placeholder').toString('base64'),
    sourceFileName: 'reporting-济南.xlsx',
    parsedSummaryJson: null,
    diffSummaryJson: null,
    errorSummaryJson: null,
    confirmedAt: null,
    attemptCount: 0,
    processingStartedAt: null,
    failureCode: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const importJobRepo = {
    findOne: async () => job,
    save: async (entity) => {
      job.status = entity.status;
      job.confirmedAt = entity.confirmedAt;
      job.attemptCount = entity.attemptCount ?? job.attemptCount ?? 0;
      return entity;
    },
    // D-04 原子 CAS：首个请求认领成功（PENDING→PROCESSING），后续请求 affected=0
    createQueryBuilder: () => ({
      update: () => ({
        set: () => ({
          where: () => ({
            execute: async () => {
              if (!claimed && job.status === JobStatus.PENDING) {
                claimed = true;
                job.status = JobStatus.PROCESSING;
                job.attemptCount = Number(job.attemptCount ?? 0) + 1;
                return { affected: 1 };
              }
              return { affected: 0 };
            },
          }),
        }),
      }),
    }),
  };
  const reportingImportService = {
    preview: async () => ({ errors: [], diffSummary: { overwriteCount: 0 } }),
    execute: async () => { executeCalls += 1; return { successCount: 1, failCount: 0, errors: [] }; },
  };
  const service = new Ws6Service(
    importJobRepo, {}, {}, {}, {}, {}, {},
    { findOne: async () => null }, { findOne: async () => null }, { create: (x) => x, save: async (x) => x },
    {}, reportingImportService,
  );
  const actor = { role: Role.SYSTEM_ADMIN, userId: 1, cityId: null };
  const results = await Promise.allSettled([
    service.confirmImport(9, { confirmOverwrite: true }, actor),
    service.confirmImport(9, { confirmOverwrite: true }, actor),
  ]);
  assert.equal(
    executeCalls,
    1,
    `D-04[IMP-1]: 并发确认同一 job 应原子互斥（仅一次 execute，第二次被 CAS affected=0 拦截）；实测 executeCalls=${executeCalls}（旧代码 findOne-then-write 非原子 → 2）`,
  );
  const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
  assert.ok(
    fulfilled >= 1,
    `D-04: 至少一个请求应成功；实测 fulfilled=${fulfilled}，rejected=${results.filter((r) => r.status === 'rejected').length}`,
  );
});


test('D-04 retry 受控重试：FAILED+白名单+attempt<3+源文件可读 → PENDING+审计；超限/非白名单/无源拒绝', async () => {
  const { Ws6Service } = compiled('ws6/ws6.service.js');
  const { ImportJobType, JobStatus, Role } = apiRequire('@biz-reporting/shared-types');

  function makeRepo(status, attemptCount, failureCode, hasStorageKey, hasBase64) {
    const job = {
      id: 7,
      jobType: ImportJobType.CITY_REPORTING,
      operatorUserId: 1,
      cityId: 1,
      reportYear: 2026,
      status,
      sourceFileUrl: '/api/imports/7/source-file',
      sourceFileName: 'reporting-济南.xlsx',
      sourceFileStorageKey: hasStorageKey ? 'ab/abcdef' : null,
      sourceFileBase64: hasBase64 ? Buffer.from('xlsx').toString('base64') : null,
      parsedSummaryJson: null,
      diffSummaryJson: null,
      errorSummaryJson: null,
      confirmedAt: null,
      attemptCount,
      processingStartedAt: null,
      failureCode,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const ops = [];
    const importJobRepo = {
      findOne: async () => job,
      save: async (entity) => { Object.assign(job, entity); return entity; },
      createQueryBuilder: () => ({
        addSelect: () => ({ where: () => ({ getOne: async () => job }) }),
      }),
    };
    const operationLogRepo = { create: (x) => x, save: async (x) => { ops.push(x); return x; } };
    const service = new Ws6Service(
      importJobRepo, {}, {}, {}, {}, {}, {},
      { findOne: async () => null }, { findOne: async () => null }, operationLogRepo,
      {}, {},
    );
    return { service, job, ops };
  }
  const actor = { role: Role.SYSTEM_ADMIN, userId: 1, cityId: null };

  // 1. 成功重试：FAILED + attempt=1 + IMPORT_ATOMICITY_FAILED + storage key → PENDING + 审计
  {
    const { service, job, ops } = makeRepo(JobStatus.FAILED, 1, 'IMPORT_ATOMICITY_FAILED', true, false);
    const result = await service.retryImportJob(7, actor);
    assert.equal(result.status, JobStatus.PENDING, 'D-04: 重试成功应置 PENDING');
    assert.equal(job.failureCode, null, 'D-04: 重试后 failureCode 应清空');
    const auditTypes = ops.map((o) => o.actionType ?? o.action_type ?? '');
    assert.ok(auditTypes.includes('import_retry'), 'D-04: 应记录 import_retry 审计，实测=' + JSON.stringify(auditTypes));
  }
  // 2. attempt 超限拒绝
  {
    const { service } = makeRepo(JobStatus.FAILED, 3, 'IMPORT_ATOMICITY_FAILED', true, false);
    await assert.rejects(() => service.retryImportJob(7, actor), /最大重试次数/, 'D-04: attempt>=3 应拒绝重试');
  }
  // 3. 非白名单 failureCode 拒绝
  {
    const { service } = makeRepo(JobStatus.FAILED, 1, 'IMPORT_PARSE_CRASH', true, false);
    await assert.rejects(() => service.retryImportJob(7, actor), /不可自动重试/, 'D-04: 非白名单 failureCode 应拒绝');
  }
  // 4. legacy 无源（无 storage key 且无 base64）→ LEGACY_REVIEW_REQUIRED
  {
    const { service } = makeRepo(JobStatus.FAILED, 1, 'IMPORT_ATOMICITY_FAILED', false, false);
    await assert.rejects(() => service.retryImportJob(7, actor), /LEGACY_REVIEW_REQUIRED/, 'D-04: 无源文件应返回 LEGACY_REVIEW_REQUIRED');
  }
  // 5. legacy base64 可读 → 可重试
  {
    const { service } = makeRepo(JobStatus.FAILED, 1, 'IMPORT_ATOMICITY_FAILED', false, true);
    const result = await service.retryImportJob(7, actor);
    assert.equal(result.status, JobStatus.PENDING, 'D-04: legacy base64 可读应可重试');
  }
});
