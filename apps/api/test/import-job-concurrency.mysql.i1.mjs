import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const apiRoot = path.join(repoRoot, 'apps', 'api');
const apiRequire = createRequire(path.join(apiRoot, 'package.json'));

const requiredEnvironment = [
  'I1_MYSQL_HOST',
  'I1_MYSQL_PORT',
  'I1_MYSQL_USER',
  'I1_MYSQL_PASSWORD',
  'I1_MYSQL_DATABASE',
];
const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]?.trim());
if (missingEnvironment.length > 0) {
  throw new Error(`I1_MYSQL_ENV_MISSING names=${missingEnvironment.join(',')}`);
}
if (process.env.I1_MYSQL_ISOLATED !== '1') throw new Error('I1_MYSQL_ISOLATED_MARKER_REQUIRED');
if (String(process.env.NODE_ENV).toLowerCase() === 'production') throw new Error('I1_MYSQL_REFUSES_PRODUCTION_ENV');
if (process.env.I1_MYSQL_USER.trim().toLowerCase() === 'root') throw new Error('I1_MYSQL_ROOT_USER_FORBIDDEN');
if (!/^biz_reporting_i1_[a-z0-9_]+$/.test(process.env.I1_MYSQL_DATABASE)) {
  throw new Error('I1_MYSQL_DATABASE_NAME_FORBIDDEN');
}
const port = Number(process.env.I1_MYSQL_PORT);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 3306) {
  throw new Error('I1_MYSQL_ISOLATED_PORT_REQUIRED');
}

function compiled(relativePath) {
  return apiRequire(path.join(apiRoot, 'dist', relativePath));
}

function makeReportingXlsx() {
  const XLSX = apiRequire('xlsx');
  const contractRows = [
    ['地市', '合同名称', '合同编码', '备注', '单位', '1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月', '合计'],
    ['单位：万元', '', '', '', '', null, null, null, null, null, null, null, null, null, null, null, null, null],
    ['济南', '合同甲', 'C001', '', '', 100, 100, null, null, null, null, null, null, null, null, null, null, null],
  ];
  const costRows = [
    ['类别', '1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月'],
    ['人工成本', 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 50],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(contractRows), '合同订单-济南');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(costRows), '成本测算-济南');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

test('I1 MySQL: concurrent reporting imports use a native atomic upsert', async () => {
  apiRequire('reflect-metadata');
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

  const dataSource = new DataSource({
    type: 'mysql',
    host: process.env.I1_MYSQL_HOST,
    port,
    username: process.env.I1_MYSQL_USER,
    password: process.env.I1_MYSQL_PASSWORD,
    database: process.env.I1_MYSQL_DATABASE,
    synchronize: true,
    dropSchema: true,
    charset: 'utf8mb4',
    entities: [
      CityEntity,
      ContractEntity,
      AllocationEntity,
      AnnualPackageEntity,
      ContractMonthRowEntity,
      CostMonthRowEntity,
      MaintenanceMonthRowEntity,
    ],
  });

  await dataSource.initialize();
  try {

    const cityRepo = dataSource.getRepository(CityEntity);
    const contractRepo = dataSource.getRepository(ContractEntity);
    const allocationRepo = dataSource.getRepository(AllocationEntity);
    await cityRepo.save(cityRepo.create({ id: 1, name: '济南', code: '370100', sortOrder: 1 }));
    await contractRepo.save(contractRepo.create({
      id: 1,
      contractCode: 'C001',
      contractName: '合同甲',
      isDeleted: SoftDeleteFlag.NOT_DELETED,
      rate: 0.05,
      contractAmount: 100,
      createdBy: 1,
      updatedBy: 1,
    }));
    await allocationRepo.save(allocationRepo.create({
      id: 1,
      contractId: 1,
      cityId: 1,
      cityContractAmount: 100,
      rate: 0.05,
    }));

    const service = new ReportingImportService(contractRepo, cityRepo, dataSource);
    const workbook = makeReportingXlsx();
    const results = await Promise.allSettled([
      service.execute(workbook, 2026, 1, 'reporting-济南.xlsx', null, ReportingImportScope.ALL),
      service.execute(workbook, 2026, 1, 'reporting-济南.xlsx', null, ReportingImportScope.ALL),
    ]);
    const rejected = results.filter((result) => result.status === 'rejected');
    assert.equal(rejected.length, 0, `concurrent imports rejected: ${rejected.map((result) => String(result.reason)).join('; ')}`);
    assert.equal(await dataSource.getRepository(AnnualPackageEntity).count(), 1);
    assert.equal(await dataSource.getRepository(ContractMonthRowEntity).count(), 1);
  } finally {
    await dataSource.destroy();
  }
});
