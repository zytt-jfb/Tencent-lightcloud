/**
 * B-03 阶段二 · 红测：导入事务原子性（WS6-D03-1 P0 / WS6-D03-2 P0 / IMP-2 P1）
 *
 * 覆盖缺陷：
 *  - WS6-D03-1 reporting import 事务部分提交（reporting-import.service.ts:178 事务内 :242/:248/:254/:289/:320/:325/:330
 *    errors.push+continue → :351 提交）。红测必须模拟「校验通过后、事务内状态变化」的 TOCTOU：前置校验
 *    validateParsedImport（:173-175 拦截静态错误）通过后，事务内合同 C002 消失 → 第 2 行被跳过、第 1 行仍写入并提交。
 *  - WS6-D03-2 contract import 同款事务缺陷 + successCount 虚高（contract-import.service.ts:125、:234）：
 *    缺城市分配行不抛异常、事务照常提交，且 successCount = allocations.length（含被跳过行）。
 *  - IMP-2     新旧路径状态判定不一致（ws6.service.ts:269 新路径 vs :392 旧路径）：
 *    「部分成功+有错误」时旧 confirmImport 标 COMPLETED，新 confirmBoundImport 标 FAILED。
 *
 * D-03 转绿语义：修复后 execute 在事务内 errors 非空即抛 AtomicityError 整批回滚。
 * 红测语义（B-03 阶段）：旧代码不满足 → 测试失败（exit 1）→ 红。
 *  - WS6-D03-1：期望 execute 抛 AtomicityError 且业务表零残留（失败即全回滚）；旧代码提交部分行 → 残留 > 0 → 红。
 *  - WS6-D03-2：期望 successCount = 实际写入数（1）且失败行回滚；旧代码 successCount=2 虚高 + 1 行残留 → 红。
 *  - IMP-2   ：旧路径期望 FAILED（与错误一致）；旧代码 COMPLETED → 红；新路径对照组 FAILED → 绿。
 *
 * 执行：node apps/api/test/reporting-import-atomicity.integration.mjs（node:test，零新增依赖）
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
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'biz-b03-p2-atomicity-'));
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

function makeReportingXlsx() {
  const XLSX = apiRequire('xlsx');
  // 两行合同订单（C001/C002 均为首月数据）+ 一行成本类别（12 个月）
  const ws1Data = [
    ['地市', '合同名称', '合同编码', '备注', '单位', '1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月', '合计'],
    ['单位：万元', '', '', '', '', null, null, null, null, null, null, null, null, null, null, null, null, null],
    ['济南', '合同甲', 'C001', '', '', 100, 100, null, null, null, null, null, null, null, null, null, null, null],
    ['济南', '合同乙', 'C002', '', '', 200, 200, null, null, null, null, null, null, null, null, null, null, null],
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

function makeContractXlsx() {
  const XLSX = apiRequire('xlsx');
  // 两行合同转化：济南(存在) + 青岛(不存在) → 青岛行被跳过、事务仍提交
  const data = [
    ['地市', '合同编码', '合同名称', '合同金额万元', '管理费率', '签订日期', '到期时间', '累计订单金额', '累计开票金额', '26年预估订单', '26年预计收入'],
    ['济南', 'C001', '合同甲', 100, 0.05, '2026-01-01', '2026-12-31', 0, 0, 0, 0],
    ['青岛', 'C002', '合同乙', 200, 0.05, '2026-01-01', '2026-12-31', 0, 0, 0, 0],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(data), '合同转化');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

test('WS6-D03-1 红测：TOCTOU 中间行失败 → 期望业务表零残留，旧代码部分提交残留>0', async () => {
  const { DataSource } = apiRequire('typeorm');
  const { SoftDeleteFlag } = apiRequire('@biz-reporting/shared-types');
  const {
    CityEntity,
    ContractEntity,
    AllocationEntity,
    AnnualPackageEntity,
    ContractMonthRowEntity,
    CostMonthRowEntity,
    MaintenanceMonthRowEntity,
  } = {
    CityEntity: compiled('cities/city.entity.js').CityEntity,
    ContractEntity: compiled('contracts/contract.entity.js').ContractEntity,
    AllocationEntity: compiled('contracts/allocation.entity.js').AllocationEntity,
    AnnualPackageEntity: compiled('packages/annual-package.entity.js').AnnualPackageEntity,
    ContractMonthRowEntity: compiled('packages/contract-month-row.entity.js').ContractMonthRowEntity,
    CostMonthRowEntity: compiled('packages/cost-month-row.entity.js').CostMonthRowEntity,
    MaintenanceMonthRowEntity: compiled('packages/maintenance-month-row.entity.js').MaintenanceMonthRowEntity,
  };
  const { ReportingImportService, ReportingImportScope } = compiled('ws6/reporting-import.service.js');

  const ds = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    synchronize: true,
    entities: [CityEntity, ContractEntity, AllocationEntity, AnnualPackageEntity, ContractMonthRowEntity, CostMonthRowEntity, MaintenanceMonthRowEntity],
  });
  await ds.initialize();
  try {
    const cityRepo = ds.getRepository(CityEntity);
    const contractRepo = ds.getRepository(ContractEntity);
    const allocRepo = ds.getRepository(AllocationEntity);
    await cityRepo.save(cityRepo.create({ id: 1, name: '济南', code: '370100', sortOrder: 1 }));
    await contractRepo.save(contractRepo.create({ id: 1, contractCode: 'C001', contractName: '合同甲', isDeleted: SoftDeleteFlag.NOT_DELETED, rate: 0.05, contractAmount: 100, createdBy: 1, updatedBy: 1 }));
    await contractRepo.save(contractRepo.create({ id: 2, contractCode: 'C002', contractName: '合同乙', isDeleted: SoftDeleteFlag.NOT_DELETED, rate: 0.05, contractAmount: 200, createdBy: 1, updatedBy: 1 }));
    await allocRepo.save(allocRepo.create({ id: 1, contractId: 1, cityId: 1, cityContractAmount: 100, rate: 0.05 }));
    await allocRepo.save(allocRepo.create({ id: 2, contractId: 2, cityId: 1, cityContractAmount: 200, rate: 0.05 }));

    // TOCTOU：前置校验通过的 C002 在事务内消失（模拟校验与执行之间 DB 状态变化）
    const dataSource = {
      getRepository: (entity) => ds.getRepository(entity),
      transaction: async (cb) => ds.transaction(async (manager) => {
        const realContractRepo = manager.getRepository(ContractEntity);
        const proxiedContractRepo = {
          ...realContractRepo,
          find: async (opts) => {
            const rows = await realContractRepo.find(opts);
            return rows.filter((r) => r.contractCode !== 'C002');
          },
        };
        const proxiedManager = {
          getRepository: (entity) => (entity === ContractEntity ? proxiedContractRepo : manager.getRepository(entity)),
        };
        return cb(proxiedManager);
      }),
    };

    const service = new ReportingImportService(contractRepo, cityRepo, dataSource);
    const { AtomicityError } = compiled('ws6/reporting-import.service.js');
    await assert.rejects(
      () => service.execute(makeReportingXlsx(), 2026, 1, 'reporting-济南.xlsx', null, ReportingImportScope.ALL),
      (err) => err instanceof AtomicityError,
      'D-03: TOCTOU 中间行失败应抛 AtomicityError（整批回滚信号）',
    );
    const residual = await ds.getRepository(ContractMonthRowEntity).count();
    assert.equal(
      residual,
      0,
      `D-03[WS6-D03-1]: 中间行失败后业务表应零残留（事务回滚），实测残留=${residual}`,
    );
  } finally {
    await ds.destroy();
  }
});

test('WS6-D03-1 红测：末行失败同款缺陷 → 期望零残留，旧代码残留>0', async () => {
  const { DataSource } = apiRequire('typeorm');
  const { SoftDeleteFlag } = apiRequire('@biz-reporting/shared-types');
  const { ContractEntity } = compiled('contracts/contract.entity.js');
  const { CityEntity } = compiled('cities/city.entity.js');
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
    await contractRepo.save(contractRepo.create({ id: 2, contractCode: 'C002', contractName: '合同乙', isDeleted: SoftDeleteFlag.NOT_DELETED, rate: 0.05, contractAmount: 200, createdBy: 1, updatedBy: 1 }));
    await allocRepo.save(allocRepo.create({ id: 1, contractId: 1, cityId: 1, cityContractAmount: 100, rate: 0.05 }));
    await allocRepo.save(allocRepo.create({ id: 2, contractId: 2, cityId: 1, cityContractAmount: 200, rate: 0.05 }));

    // TOCTOU：事务内 contractMap 仅含 C001 → C002（末行）在校验后被跳过
    const dataSource = {
      getRepository: (entity) => ds.getRepository(entity),
      transaction: async (cb) => ds.transaction(async (manager) => {
        const realContractRepo = manager.getRepository(ContractEntity);
        const proxiedContractRepo = { ...realContractRepo, find: async (opts) => (await realContractRepo.find(opts)).filter((r) => r.contractCode !== 'C002') };
        const proxiedManager = { getRepository: (entity) => (entity === ContractEntity ? proxiedContractRepo : manager.getRepository(entity)) };
        return cb(proxiedManager);
      }),
    };

    const service = new ReportingImportService(contractRepo, cityRepo, dataSource);
    const { AtomicityError } = compiled('ws6/reporting-import.service.js');
    await assert.rejects(
      () => service.execute(makeReportingXlsx(), 2026, 1, 'reporting-济南.xlsx', null, ReportingImportScope.ALL),
      (err) => err instanceof AtomicityError,
      'D-03: TOCTOU 末行失败应抛 AtomicityError（整批回滚信号）',
    );
    const residual = await ds.getRepository(ContractMonthRowEntity).count();
    assert.equal(residual, 0, `D-03[WS6-D03-1]: 末行失败后业务表应零残留（事务回滚），实测残留=${residual}`);
  } finally {
    await ds.destroy();
  }
});

test('WS6-D03-2 红测：contract import 缺城市行 → 期望 successCount=实际写入数且零残留，旧代码虚高+残留', async () => {
  const { DataSource } = apiRequire('typeorm');
  const { SoftDeleteFlag } = apiRequire('@biz-reporting/shared-types');
  const { ContractEntity } = compiled('contracts/contract.entity.js');
  const { CityEntity } = compiled('cities/city.entity.js');
  const { AllocationEntity } = compiled('contracts/allocation.entity.js');
  const { ContractCityBusinessMetricEntity } = compiled('contracts/contract-city-business-metric.entity.js');
  const { ContractImportService } = compiled('ws6/contract-import.service.js');

  const ds = new DataSource({
    type: 'better-sqlite3', database: ':memory:', synchronize: true,
    entities: [CityEntity, ContractEntity, AllocationEntity, ContractCityBusinessMetricEntity],
  });
  await ds.initialize();
  try {
    const cityRepo = ds.getRepository(CityEntity);
    const contractRepo = ds.getRepository(ContractEntity);
    const allocRepo = ds.getRepository(AllocationEntity);
    await cityRepo.save(cityRepo.create({ id: 1, name: '济南', code: '370100', sortOrder: 1 }));
    await contractRepo.save(contractRepo.create({ id: 1, contractCode: 'C001', contractName: '合同甲', isDeleted: SoftDeleteFlag.NOT_DELETED, rate: 0.05, contractAmount: 100, createdBy: 1, updatedBy: 1 }));
    await contractRepo.save(contractRepo.create({ id: 2, contractCode: 'C002', contractName: '合同乙', isDeleted: SoftDeleteFlag.NOT_DELETED, rate: 0.05, contractAmount: 200, createdBy: 1, updatedBy: 1 }));

    const service = new ContractImportService(contractRepo, allocRepo, cityRepo, ds);
    const { AtomicityError } = compiled('ws6/reporting-import.service.js');
    let thrownErrors = null;
    await assert.rejects(
      () => service.execute(makeContractXlsx(), 1, 'contract-转化.xlsx'),
      (err) => {
        if (err instanceof AtomicityError) {
          thrownErrors = err.errors;
          return true;
        }
        return false;
      },
      'D-03: contract 缺城市行应抛 AtomicityError（整批回滚信号）',
    );
    assert.ok(thrownErrors && thrownErrors.some((e) => e.message.includes('青岛')), `D-03[WS6-D03-2]: AtomicityError 应携带缺城市错误，实测=${JSON.stringify(thrownErrors)}`);
    const allocationResidual = await ds.getRepository(AllocationEntity).count();
    assert.equal(
      allocationResidual,
      0,
      `D-03[WS6-D03-2]: 缺城市行失败后 allocations 应零残留（事务回滚），实测残留=${allocationResidual}`,
    );
  } finally {
    await ds.destroy();
  }
});

test('IMP-2 红测：旧路径 confirmImport 部分成功+有错误 → 期望 FAILED，旧代码 COMPLETED', async () => {
  const { Ws6Service } = compiled('ws6/ws6.service.js');
  const { ImportJobType, JobStatus, Role } = apiRequire('@biz-reporting/shared-types');

  const saved = [];
  const job = {
    id: 1,
    jobType: ImportJobType.CITY_REPORTING,
    operatorUserId: 1,
    cityId: 1,
    reportYear: 2026,
    status: JobStatus.PENDING,
    sourceFileUrl: '/api/imports/1/source-file',
    sourceFileBase64: Buffer.from('xlsx-placeholder').toString('base64'),
    sourceFileName: 'reporting-济南.xlsx',
    parsedSummaryJson: null,
    diffSummaryJson: null,
    errorSummaryJson: null,
    confirmedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const importJobRepo = {
    findOne: async () => job,
    save: async (entity) => { saved.push({ ...entity }); return entity; },
    // D-04：CAS 认领成功（affected=1），让 confirm 继续执行到 execute
    createQueryBuilder: () => ({
      update: () => ({ set: () => ({ where: () => ({ execute: async () => ({ affected: 1 }) }) }) }),
    }),
  };
  const reportingImportService = {
    preview: async () => ({ errors: [], diffSummary: { overwriteCount: 0 } }),
    // 部分成功：1 条成功 + 1 条错误
    execute: async () => ({ successCount: 1, failCount: 1, errors: [{ row: 4, message: '合同 C002 不存在，请先上传合同' }] }),
  };
  const service = new Ws6Service(
    importJobRepo, {}, {}, {}, {}, {}, {},
    { findOne: async () => null }, { findOne: async () => null }, { create: (x) => x, save: async (x) => x },
    {}, reportingImportService,
  );
  const result = await service.confirmImport(1, { confirmOverwrite: true }, { role: Role.SYSTEM_ADMIN, userId: 1, cityId: null });
  assert.equal(
    job.status,
    JobStatus.FAILED,
    `RED_EXPECTED[IMP-2]: 旧路径 confirmImport 在「部分成功+有错误」时应标 FAILED（ws6.service.ts:392 只判 successCount<=0）；旧代码实测 job.status=${job.status}（返回 ${JSON.stringify(result)}）→ COMPLETED 与业务表残留不一致`,
  );
});

test('IMP-2 对照组（绿）：新路径 confirmBoundImport 同场景 → FAILED（新旧不一致即缺陷证据）', async () => {
  const { Ws6Service } = compiled('ws6/ws6.service.js');
  const { ImportJobType, JobStatus, Role } = apiRequire('@biz-reporting/shared-types');

  const saved = [];
  const job = {
    id: 2,
    jobType: ImportJobType.CITY_REPORTING,
    operatorUserId: 1,
    cityId: 1,
    reportYear: 2026,
    status: JobStatus.PREVIEWED,
    sourceFileUrl: '/api/imports/2/source-file',
    sourceFileBase64: Buffer.from('xlsx-placeholder').toString('base64'),
    sourceFileName: 'reporting-济南.xlsx',
    parsedSummaryJson: { errors: [] },
    diffSummaryJson: { overwriteCount: 0 },
    errorSummaryJson: null,
    confirmedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const importJobRepo = {
    findOne: async () => job,
    save: async (entity) => { saved.push({ ...entity }); return entity; },
    // D-04：CAS 认领成功（affected=1），让 confirm 继续执行到 execute
    createQueryBuilder: () => ({
      update: () => ({ set: () => ({ where: () => ({ execute: async () => ({ affected: 1 }) }) }) }),
    }),
  };
  const reportingImportService = {
    execute: async () => ({ successCount: 1, failCount: 1, errors: [{ row: 4, message: '合同 C002 不存在，请先上传合同' }] }),
  };
  const service = new Ws6Service(
    importJobRepo, {}, {}, {}, {}, {}, {},
    { findOne: async () => null }, { findOne: async () => null },
    { create: (x) => x, save: async (x) => x },
    {}, reportingImportService,
  );
  const result = await service.confirmBoundImport(2, { role: Role.SYSTEM_ADMIN, userId: 1, cityId: null }, true);
  assert.equal(
    result.status,
    JobStatus.FAILED,
    `CONTROL_EXPECTED[IMP-2]: 新路径 confirmBoundImport 同场景应 FAILED（ws6.service.ts:269 同时检查 errors）；实测 ${result.status}（若此处非 FAILED 说明测试环境问题，而非缺陷）`,
  );
});
