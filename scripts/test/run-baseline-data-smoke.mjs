import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const apiRoot = path.join(repoRoot, 'apps', 'api');
const requireFromApi = createRequire(path.join(apiRoot, 'package.json'));
const { DataSource } = requireFromApi('typeorm');

const testRoot = mkdtempSync(path.join(tmpdir(), 'biz-baseline-smoke-'));
const database = path.join(testRoot, 'baseline.sqlite');
const env = { ...process.env, NODE_ENV: 'test', DB_TYPE: 'sqlite', DB_DATABASE: database, DB_SYNC: 'false' };

try {
  // 1. 空库执行 001-011 全部迁移
  execFileSync(process.execPath, ['scripts/db/migrate.mjs', 'up'], { cwd: repoRoot, env, stdio: 'inherit' });

  // 2. TypeORM 加载全部实体（synchronize=false，验证实体与迁移结构一致）
  const ds = new DataSource({
    type: 'better-sqlite3',
    database,
    entities: [path.join(apiRoot, 'dist', '**', '*.entity.js')],
    synchronize: false,
  });
  await ds.initialize();

  // 3. 种子数据断言
  const roleRepo = ds.getRepository('RoleEntity');
  assert.equal(await roleRepo.count({ where: { isBuiltin: true } }), 4, 'expect 4 builtin roles');
  const roles = await roleRepo.find({ order: { code: 'ASC' } });
  assert.deepEqual(roles.map((r) => r.code), ['admin', 'city_user', 'contract_manager', 'super_admin'], 'seed roles mismatch');

  const cityRepo = ds.getRepository('CityEntity');
  assert.equal(await cityRepo.count(), 16, 'expect 16 shandong cities');
  assert.ok(await cityRepo.findOneBy({ code: '370100' }), 'jinan city missing');

  const provinceRepo = ds.getRepository('ProvinceEntity');
  const shandong = await provinceRepo.findOneByOrFail({ code: '370000' });
  assert.equal(shandong.name, '山东省');

  const moduleRepo = ds.getRepository('ModuleEntity');
  assert.equal(await moduleRepo.count(), 5, 'expect 5 modules (2 level1 + 3 level2)');
  const operation = await moduleRepo.findOneByOrFail({ code: 'operation' });
  assert.equal(operation.level, 'level2');
  assert.ok(operation.parentId, 'operation module requires parent (maintenance)');

  const categoryRepo = ds.getRepository('BizCostCategoryEntity');
  assert.equal(await categoryRepo.count(), 7, 'expect 7 cost categories');

  // 4. 合同 CRUD：UUID / 整数分 / draft / amount_locked=false / version_no=1
  const contractRepo = ds.getRepository('BizContractEntity');
  const contractId = randomUUID();
  await contractRepo.save({
    id: contractId,
    contractNo: 'HT-2026-0001',
    contractName: '测试合同（脱敏）',
    taxInclusiveAmountFen: 1_000_000_00, // 1,000,000.00 元
    provinceId: shandong.id,
    status: 'draft',
    amountLocked: false,
    versionNo: 1,
    createdBy: '00000000-0000-4000-8000-000000000001',
    updatedBy: '00000000-0000-4000-8000-000000000001',
  });
  const saved = await contractRepo.findOneByOrFail({ id: contractId });
  assert.equal(saved.contractNo, 'HT-2026-0001');
  assert.equal(saved.taxInclusiveAmountFen, 1_000_000_00, 'integer fen amount must round-trip');
  assert.equal(saved.status, 'draft');
  assert.equal(saved.amountLocked, false);
  assert.equal(saved.versionNo, 1);

  // 5. 真实合同号全局唯一约束（服务端 + DB 双保险）
  await assert.rejects(
    contractRepo.save({
      id: randomUUID(),
      contractNo: 'HT-2026-0001', // 重复合同号
      contractName: '重复合同号应被拒绝',
      taxInclusiveAmountFen: 100,
      provinceId: shandong.id,
      status: 'draft',
      createdBy: '00000000-0000-4000-8000-000000000001',
      updatedBy: '00000000-0000-4000-8000-000000000001',
    }),
    /UNIQUE|duplicate/i,
    'duplicate contract_no must be rejected by DB unique index',
  );

  // 6. 合同-地市分配：额度整数分 + (contract_id, city_id) 唯一
  const allocRepo = ds.getRepository('BizContractCityAllocationEntity');
  const jinan = await cityRepo.findOneByOrFail({ code: '370100' });
  const allocId = randomUUID();
  await allocRepo.save({
    id: allocId,
    contractId,
    cityId: jinan.id,
    quotaFen: 600_000_00, // 600,000.00 元
    status: 'active',
    versionNo: 1,
  });
  await assert.rejects(
    allocRepo.save({
      id: randomUUID(),
      contractId,
      cityId: jinan.id,
      quotaFen: 100,
      status: 'active',
      versionNo: 1,
    }),
    /UNIQUE|duplicate/i,
    'duplicate contract+city allocation must be rejected',
  );

  // 7. 费率历史：整数基点 + (contract, city, month) 唯一
  const feeRepo = ds.getRepository('BizContractFeeRateEntity');
  await feeRepo.save({
    id: randomUUID(),
    contractId,
    cityId: jinan.id,
    effectiveMonth: '2026-01',
    rateBp: 1235, // 12.35%
  });
  await assert.rejects(
    feeRepo.save({
      id: randomUUID(),
      contractId,
      cityId: jinan.id,
      effectiveMonth: '2026-01',
      rateBp: 1000,
    }),
    /UNIQUE|duplicate/i,
    'duplicate fee rate (contract,city,month) must be rejected',
  );

  // 8. 订单批次指纹唯一（file_hash + max_order_time）
  const batchRepo = ds.getRepository('BizOrderImportBatchEntity');
  const batchId = randomUUID();
  const fingerprint = randomUUID().replace(/-/g, '');
  await batchRepo.save({
    id: batchId,
    filename: 'orders-2026-01.xlsx',
    fileHash: fingerprint,
    maxOrderTime: new Date('2026-01-31T08:00:00Z'),
    idempotencyKey: randomUUID(),
    status: 'imported',
    totalRows: 2,
    importedRows: 2,
    uploadedBy: '00000000-0000-4000-8000-000000000002',
  });
  await assert.rejects(
    batchRepo.save({
      id: randomUUID(),
      filename: 'orders-2026-01-copy.xlsx',
      fileHash: fingerprint, // 相同指纹
      maxOrderTime: new Date('2026-01-31T08:00:00Z'),
      idempotencyKey: randomUUID(),
      status: 'imported',
      uploadedBy: '00000000-0000-4000-8000-000000000002',
    }),
    /UNIQUE|duplicate/i,
    'duplicate file fingerprint (hash+max_order_time) must be rejected',
  );

  // 9. 订单行：34 列原值 + 标准化字段 + 整数分
  const rowRepo = ds.getRepository('BizOrderRowEntity');
  await rowRepo.save({
    id: randomUUID(),
    batchId,
    sourceRowNo: 2,
    provinceName: '山东省',
    cityName: '济南市',
    purchaseOrderNo: 'PO-2026-000001',
    taxInclusiveAmountRaw: '172.50',
    contractNoRaw: 'HT-2026-0001',
    orderTimeRaw: '2026-01-15 10:00:00',
    provinceId: shandong.id,
    cityId: jinan.id,
    contractId,
    businessMonth: '2026-01',
    completionAmountFen: 17_250, // 172.50 元
    feeRateSnapshotBp: 1235,
    grossProfitFen: 2_130, // 17250 * 12.35% ≈ 2130.4 -> 2130
    cityOverrunFlag: false,
    contractOverrunFlag: false,
    isVoid: false,
  });
  const row = await rowRepo.findOneByOrFail({ batchId });
  assert.equal(row.completionAmountFen, 17_250);
  assert.equal(row.provinceName, '山东省');
  assert.equal(row.businessMonth, '2026-01');

  // 10. 汇总表唯一维度 + 整数分
  const aggRepo = ds.getRepository('BizMonthlyAggregateEntity');
  await aggRepo.save({
    id: randomUUID(),
    provinceId: shandong.id,
    cityId: jinan.id,
    contractId,
    businessMonth: '2026-01',
    orderCompletionFen: 17_250,
    offlineCompletionFen: 0,
    grossProfitFen: 2_130,
    costFen: 0,
    netProfitFen: 2_130,
    staleFlag: false,
  });

  // 先显式关闭 better-sqlite3 底层句柄（Windows 下 TypeORM destroy 不保证立即释放）
  try {
    const driver = ds.driver;
    if (driver.connection && typeof driver.connection.close === 'function') driver.connection.close();
  } catch { /* ignore */ }
  await ds.destroy();
  console.log('BASELINE_DATA_SMOKE_OK entities=20 seeds=roles:4,cities:16,provinces:1,modules:5,categories:7 crud=contract,alloc,fee,batch,row,aggregate unique=contract_no,alloc,rate,batch_fingerprint');
} finally {
  // Windows 文件锁：等待句柄释放后带重试删除
  await new Promise((resolve) => setTimeout(resolve, 300));
  try {
    rmSync(testRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // 残留临时目录交由 OS 清理，不影响测试结论
    console.log(`BASELINE_DATA_SMOKE_CLEANUP_WARN root=${testRoot}`);
  }
  console.log(`BASELINE_DATA_SMOKE_CLEANUP_OK root=${testRoot}`);
}
