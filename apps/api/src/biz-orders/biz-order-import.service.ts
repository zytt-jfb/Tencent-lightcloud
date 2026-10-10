import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import {
  ORDER_TEMPLATE_COLUMNS, ORDER_TEMPLATE_COLUMN_COUNT, ORDER_TEMPLATE_SHEET_COUNT,
  ORDER_TEMPLATE_COLUMN_INDEX_MAP, ORDER_FILE_MAX_BYTES, ORDER_FILE_MAX_ROWS, ORDER_FILE_ALLOWED_EXT,
  ORDER_TEMPLATE_SENSITIVE_COLUMN_INDEXES_0BASED,
  OrderBatchStatus,
} from '@biz-reporting/shared-types';
import { readWorkbookSafe } from '../common/files/workbook-policy';
import { BizOrderImportBatchEntity } from '../orders/biz-order-import-batch.entity';
import { BizOrderRowEntity } from '../orders/biz-order-row.entity';
import { BizOrderImportErrorEntity } from '../orders/biz-order-import-error.entity';
import { BizContractEntity } from '../contracts/biz-contract.entity';
import { BizContractCityAllocationEntity } from '../contracts/biz-contract-city-allocation.entity';
import { BizContractFeeRateEntity } from '../contracts/biz-contract-fee-rate.entity';
import { ProvinceEntity } from '../main-data/province.entity';
import { CityEntity } from '../main-data/city.entity';
import { CityAliasEntity } from '../main-data/city-alias.entity';
import { BizOperationLogEntity } from '../operation-logs/biz-operation-log.entity';
import { PlatformUserEntity } from '../rbac/platform-user.entity';
import { BizContractsService } from '../biz-contracts/biz-contracts.service';
import { BizAggregateService } from '../biz-aggregates/biz-aggregate.service';
import { BizAuthContext } from '../rbac/rbac.service';
import { BizSnapshotRegistryEntity } from '../biz-snapshots/biz-snapshot-registry.entity';
import { BizOrderUploadPartEntity } from '../orders/biz-order-upload-part.entity';

interface PendingRow {
  sourceRowNo: number;
  raw: string[];
  provinceId: string | null;
  cityId: string | null;
  contractId: string | null;
  orderTimeStd: Date | null;
  businessMonth: string | null;
  completionAmountFen: number | null;
  feeRateSnapshotBp: number | null;
  grossProfitFen: number | null;
  replacesOrderRowId: string | null;
  error?: { type: string; field: string; message: string };
}

const CORRECTION_SOURCE_BATCH_HEADER = '修正来源批次ID';
const CORRECTION_SOURCE_ROW_HEADER = '修正来源订单行ID';
const CORRECTION_SOURCE_ROW_NO_HEADER = '原始Excel行号';
const CORRECTION_ERROR_HEADER = '当前错误原因';
const CORRECTION_HEADERS = [
  CORRECTION_SOURCE_BATCH_HEADER,
  CORRECTION_SOURCE_ROW_HEADER,
  CORRECTION_SOURCE_ROW_NO_HEADER,
  CORRECTION_ERROR_HEADER,
] as const;

interface MaintainOrderRowInput {
  provinceId?: string;
  cityId?: string;
  contractId?: string;
  businessMonth?: string;
  feeRateSnapshotBp?: number;
  reason?: string;
}

/**
 * 订单域服务（新基线 M4）
 * 基线：01 §5 / 04 §4 / 05 / 07 TABLE 5
 * 关键规则：
 *  - 仅 super_admin/admin 上传；.xlsx、单工作表、≤50MB、≤20 万行；
 *  - 34 列模板列名/列数/顺序严格匹配；上传即导入确认（无内容审核）；
 *  - 整批校验：任一错误 → FAILED 零业务行写入 + 错误报告；
 *  - 请求幂等（idempotency_key）+ 文件哈希+最大下单时间防重（DB 唯一约束）；
 *  - 不做业务去重；正/零/负金额全部入账；两级超额不阻断导入（标识动态计算）；
 *  - 批次作废/恢复仅 super_admin；原始行永久保留；临时文件任务结束后删除。
 */
@Injectable()
export class BizOrderImportService {
  constructor(
    @InjectRepository(BizOrderImportBatchEntity)
    private readonly batchRepo: Repository<BizOrderImportBatchEntity>,
    @InjectRepository(BizOrderRowEntity)
    private readonly rowRepo: Repository<BizOrderRowEntity>,
    @InjectRepository(BizOrderImportErrorEntity)
    private readonly errorRepo: Repository<BizOrderImportErrorEntity>,
    @InjectRepository(BizContractEntity)
    private readonly contractRepo: Repository<BizContractEntity>,
    @InjectRepository(BizContractCityAllocationEntity)
    private readonly allocRepo: Repository<BizContractCityAllocationEntity>,
    @InjectRepository(BizContractFeeRateEntity)
    private readonly feeRateRepo: Repository<BizContractFeeRateEntity>,
    @InjectRepository(ProvinceEntity)
    private readonly provinceRepo: Repository<ProvinceEntity>,
    @InjectRepository(CityEntity)
    private readonly cityRepo: Repository<CityEntity>,
    @InjectRepository(CityAliasEntity)
    private readonly cityAliasRepo: Repository<CityAliasEntity>,
    @InjectRepository(BizOperationLogEntity)
    private readonly opLogRepo: Repository<BizOperationLogEntity>,
    @InjectRepository(PlatformUserEntity)
    private readonly userRepo: Repository<PlatformUserEntity>,
    private readonly dataSource: DataSource,
    private readonly contracts: BizContractsService,
    private readonly aggregates: BizAggregateService,
  ) {}

  private async recordOp(operatorId: string, actionType: string, targetId: string, resultStatus = 'success'): Promise<void> {
    await this.opLogRepo.save({
      id: randomUUID(), operatorUserId: operatorId, actionType,
      targetType: 'order_batch', targetId, resultStatus,
    });
  }

  /** 保存上传文件到受控临时目录（FACT_SOURCE_STORAGE_ROOT 或系统临时目录） */
  private saveTempFile(buffer: Buffer, batchId: string): { filePath: string; fileHash: string } {
    const root = process.env.FACT_SOURCE_STORAGE_ROOT || tmpdir();
    const dir = path.join(root, 'order-uploads');
    mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${batchId}${ORDER_FILE_ALLOWED_EXT}`);
    const hash = createHash('sha256').update(buffer).digest('hex');
    writeFileSync(filePath, buffer);
    return { filePath, fileHash: hash };
  }

  /** 上传：创建批次（PARSING）→ 后台解析；返回批次 ID 供轮询 */
  async uploadPart(auth: BizAuthContext, file: Express.Multer.File, input: {
    key: string; index: number; count: number; filename: string; sourceBatchId?: string;
  }): Promise<{ received: true }> {
    const partBytes = 4 * 1024 * 1024;
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(input.key) || !Number.isInteger(input.index)
      || !Number.isInteger(input.count) || input.count < 1 || input.count > 13
      || input.index < 0 || input.index >= input.count || !file?.buffer?.length
      || file.buffer.length > partBytes || (input.index < input.count - 1 && file.buffer.length !== partBytes)
      || input.filename.length > 255 || !input.filename.toLowerCase().endsWith('.xlsx')) {
      throw new BadRequestException('文件分片参数无效');
    }
    if (!input.sourceBatchId && auth.dataScope.scopeType !== 'all') throw new ForbiddenException('全量总表替换需要全部数据范围权限');
    const repo = this.dataSource.getRepository(BizOrderUploadPartEntity);
    await repo.createQueryBuilder().delete().where('created_at < :cutoff', { cutoff: new Date(Date.now() - 24 * 3600_000) }).execute();
    const part = { uploadKey: input.key, partIndex: input.index, userId: auth.userId,
      partCount: input.count, filename: input.filename, sourceBatchId: input.sourceBatchId || null,
      dataBase64: file.buffer.toString('base64') };
    await repo.createQueryBuilder().insert().values(part).orIgnore().execute();
    const stored = await repo.findOneByOrFail({ uploadKey: input.key, partIndex: input.index });
    if (stored.userId !== auth.userId || stored.partCount !== part.partCount || stored.filename !== part.filename
      || stored.sourceBatchId !== part.sourceBatchId || stored.dataBase64 !== part.dataBase64) {
      throw new BadRequestException('分片冲突，请重新上传文件');
    }
    return { received: true };
  }

  async completeUpload(auth: BizAuthContext, key: string): Promise<BizOrderImportBatchEntity> {
    const existing = await this.batchRepo.findOneBy({ idempotencyKey: key });
    if (existing) {
      if (existing.uploadedBy !== auth.userId) throw new ForbiddenException('无权访问该上传');
      return existing;
    }
    const repo = this.dataSource.getRepository(BizOrderUploadPartEntity);
    const parts = await repo.find({ where: { uploadKey: key }, order: { partIndex: 'ASC' } });
    if (!parts.length || parts.some((p) => p.userId !== auth.userId)) throw new ForbiddenException('上传不存在或无权访问');
    const first = parts[0];
    if (parts.length !== first.partCount || parts.some((p, i) => p.partIndex !== i
      || p.partCount !== first.partCount || p.filename !== first.filename || p.sourceBatchId !== first.sourceBatchId)) {
      throw new BadRequestException('分片不完整，请重新上传');
    }
    const buffer = Buffer.concat(parts.map((p) => Buffer.from(p.dataBase64, 'base64')));
    if (buffer.length > ORDER_FILE_MAX_BYTES) throw new BadRequestException('文件超过 50MB 上限');
    try {
      return await this.upload(auth, { buffer, originalname: first.filename } as Express.Multer.File, key, first.sourceBatchId || undefined);
    } finally {
      await repo.delete({ uploadKey: key, userId: auth.userId });
    }
  }

  async upload(auth: BizAuthContext, file: Express.Multer.File, idempotencyKey: string, sourceBatchId?: string): Promise<BizOrderImportBatchEntity> {
    if (!file) throw new BadRequestException('缺少上传文件');
    const filename = (file.originalname ?? 'upload.xlsx').trim();
    if (!filename.toLowerCase().endsWith(ORDER_FILE_ALLOWED_EXT)) throw new BadRequestException('仅支持 .xlsx 文件');
    const maxBytes = Number(process.env.ORDER_UPLOAD_MAX_BYTES || ORDER_FILE_MAX_BYTES);
    if (!file.buffer || file.buffer.length > maxBytes) throw new BadRequestException('文件超过 50MB 上限');

    // 幂等：相同请求键返回原批次
    const existing = await this.batchRepo.findOneBy({ idempotencyKey });
    if (existing) return existing;
    if (await this.batchRepo.countBy({ status: OrderBatchStatus.PARSING })) {
      throw new BadRequestException('已有订单文件正在解析，请等待当前导入完成后再上传');
    }

    const normalizedSourceBatchId = sourceBatchId?.trim() || null;
    if (!normalizedSourceBatchId && auth.dataScope.scopeType !== 'all') {
      throw new ForbiddenException('全量总表替换需要全部数据范围权限');
    }
    if (normalizedSourceBatchId) {
      const source = await this.batchRepo.findOneBy({ id: normalizedSourceBatchId });
      if (!source) throw new BadRequestException('来源批次不存在');
      if (source.status !== OrderBatchStatus.IMPORTED) throw new BadRequestException('仅已导入批次可上传修正文件');
      await this.batchDetail(auth, source.id);
      const pendingCount = await this.rowRepo.countBy({ batchId: source.id, validationStatus: 'needs_review' });
      if (pendingCount === 0) throw new BadRequestException('来源批次没有待维护订单');
    }

    // 保存临时文件（校验失败时也删除）
    const tempBatchId = randomUUID();
    const { filePath, fileHash } = this.saveTempFile(file.buffer, tempBatchId);

    // Extract the timestamp fingerprint before creating the batch.
    let maxOrderTime: Date | null = null;
    let parsedWorkbook: XLSX.WorkBook;
    try {
      const wb = readWorkbookSafe(file.buffer, { maxRowsPerSheet: ORDER_FILE_MAX_ROWS + 1 });
      parsedWorkbook = wb;
      maxOrderTime = this.extractMaxOrderTime(wb);
    } catch (e) {
      rmSync(filePath, { force: true });
      throw e;
    }

    // 重复文件：文件哈希 + 最大下单时间（两者均相同才阻止；DB 唯一约束兜底）
    const dup = await this.batchRepo.findOneBy({ fileHash, maxOrderTime: maxOrderTime ?? undefined });
    if (dup) {
      rmSync(filePath, { force: true });
      throw new BadRequestException(`重复文件：已存在批次 ${dup.id}（相同文件与最大下单时间）`);
    }

    const batch = await this.batchRepo.save({
      id: randomUUID(),
      filename,
      fileHash,
      maxOrderTime,
      idempotencyKey,
      status: OrderBatchStatus.PARSING,
      totalRows: 0,
      importedRows: 0,
      uploadedBy: auth.userId,
      tempFilePath: filePath,
      dataScopeJson: JSON.stringify({ roleCode: auth.roleCode, scopeType: auth.dataScope.scopeType, provinceIds: auth.dataScope.provinceIds ?? [], cityIds: auth.dataScope.cityIds ?? [], cityId: auth.dataScope.cityId ?? null }),
      sourceBatchId: normalizedSourceBatchId,
      batchPurpose: normalizedSourceBatchId ? 'correction' : 'normal',
    });

    // 后台异步解析（单实例进程内任务；幂等与唯一约束保障重试安全）
    void this.processBatch(batch.id, parsedWorkbook).catch((err: unknown) => {
      void this.failBatch(batch.id, err instanceof Error ? err.message : String(err));
    });
    return batch;
  }

  /** 后台解析：结构校验 → 整批校验 → 全过才写入（零业务行部分写入） */
  private async processBatch(batchId: string, parsedWorkbook?: XLSX.WorkBook): Promise<void> {
    const batch = await this.batchRepo.findOneBy({ id: batchId });
    if (!batch || batch.status !== OrderBatchStatus.PARSING) return;

    const filePath = batch.tempFilePath;
    if (!filePath || !existsSync(filePath)) {
      await this.failBatch(batchId, '临时文件缺失');
      return;
    }

    let wb: XLSX.WorkBook;
    try {
      wb = parsedWorkbook ?? readWorkbookSafe(readFileSync(filePath), { maxRowsPerSheet: ORDER_FILE_MAX_ROWS + 1 });
    } catch (e) {
      await this.failBatch(batchId, e instanceof Error ? e.message : '文件解析失败');
      return;
    }

    // 1. 结构校验：单工作表 + 34 列 + 表头严格匹配
    const columnIndexes = this.resolveColumnIndexes(wb);
    if (typeof columnIndexes === 'string') {
      await this.failBatch(batchId, columnIndexes);
      return;
    }

    // 2. 预加载映射
    const provinceByName = new Map<string, string>();
    for (const p of await this.provinceRepo.find()) {
      for (const key of this.provinceNameAliases(p.name, p.code)) provinceByName.set(key, p.id);
    }
    const cityByProvinceName = new Map<string, string>();
    for (const c of await this.cityRepo.find()) {
      for (const alias of this.cityNameAliases(c.name)) {
        cityByProvinceName.set(`${c.provinceId}|${alias}`, c.id);
      }
    }
    for (const alias of await this.cityAliasRepo.find()) {
      const city = await this.cityRepo.findOneBy({ id: alias.cityId });
      if (city) cityByProvinceName.set(`${city.provinceId}|${this.normalizeRawCityName(alias.alias)}`, city.id);
    }
    const contractByNo = new Map<string, { id: string; provinceId: string }>();
    const ambiguousContractKeys = new Set<string>();
    for (const c of await this.contractRepo.find()) {
      const contract = { id: c.id, provinceId: c.provinceId };
      for (const key of [c.contractNo, c.archiveContractNo].map((value) => value?.trim()).filter((value): value is string => Boolean(value))) {
        const existing = contractByNo.get(key);
        if (existing && existing.id !== contract.id) {
          contractByNo.delete(key);
          ambiguousContractKeys.add(key);
        } else if (!ambiguousContractKeys.has(key)) {
          contractByNo.set(key, contract);
        }
      }
    }
    const allocSet = new Set<string>();
    for (const a of await this.allocRepo.find({ where: { status: 'active' } })) allocSet.add(`${a.contractId}|${a.cityId}`);
    const feeRatesByContractCity = new Map<string, BizContractFeeRateEntity[]>();
    for (const f of await this.feeRateRepo.find()) {
      const key = `${f.contractId}|${f.cityId}`;
      const list = feeRatesByContractCity.get(key) ?? [];
      list.push(f);
      feeRatesByContractCity.set(key, list);
    }

    // 3. 逐行解析 + 校验
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' });
    const dataRows = rows.slice(1); // 去掉表头
    if (dataRows.length > ORDER_FILE_MAX_ROWS) {
      await this.failBatch(batchId, `数据行数 ${dataRows.length} 超过 30 万行上限`);
      return;
    }
    if (dataRows.length === 0) {
      await this.failBatch(batchId, '文件无数据行');
      return;
    }

    const pending: PendingRow[] = [];
    const errors: Array<{ type: string; rowNo: number | null; field: string | null; message: string }> = [];
    const correctionIndexes = this.resolveCorrectionIndexes(wb);
    const correctionRows = batch.batchPurpose === 'correction'
      ? await this.loadCorrectionSourceRows(batch.sourceBatchId, batch.dataScopeJson)
      : new Map<string, BizOrderRowEntity>();
    const replacementIdsInFile = new Set<string>();

    dataRows.forEach((row, idx) => {
      const sourceRowNo = idx + 2;
      const sourceValues = Array.isArray(row) ? row.map((v) => this.stringifyOrderCell(v)) : [];
      if (sourceValues.length === 0 || sourceValues.every((v) => v === '')) return; // 跳过空行
      // 以列名映射为标准化 34 列数组；非关键列不存在时保留为空，不依赖原表列序或总列数。
      const raw = ORDER_TEMPLATE_COLUMNS.map((column) => {
        const inputIndex = columnIndexes.get(column);
        return inputIndex === undefined ? '' : (sourceValues[inputIndex] ?? '');
      });
      const requestedReplacementId = this.correctionSourceRowId(sourceValues, correctionIndexes);
      const p: PendingRow = { sourceRowNo, raw, provinceId: null, cityId: null, contractId: null, orderTimeStd: null, businessMonth: null, completionAmountFen: null, feeRateSnapshotBp: null, grossProfitFen: null, replacesOrderRowId: null };

      if (batch.batchPurpose === 'correction') {
        if (!correctionIndexes.sourceBatch || !correctionIndexes.sourceRow) {
          p.error = { type: 'correction', field: CORRECTION_SOURCE_BATCH_HEADER, message: '修正文件缺少来源批次或来源订单行标识' };
          pending.push(p);
          return;
        }
        const sourceBatchValue = this.cellFromRow(sourceValues, correctionIndexes.sourceBatch);
        const sourceRowId = requestedReplacementId ?? '';
        if (sourceBatchValue !== batch.sourceBatchId || !sourceRowId) {
          p.error = { type: 'correction', field: CORRECTION_SOURCE_ROW_HEADER, message: '修正行来源批次与订单行标识不匹配' };
          pending.push(p);
          return;
        }
        const sourceRow = correctionRows.get(sourceRowId);
        if (!sourceRow) {
          p.error = { type: 'correction', field: CORRECTION_SOURCE_ROW_HEADER, message: '来源订单行不存在、已接替或不在当前账号数据范围内' };
          pending.push(p);
          return;
        }
        if (replacementIdsInFile.has(sourceRowId)) {
          p.error = { type: 'correction', field: CORRECTION_SOURCE_ROW_HEADER, message: '同一来源订单行在修正文件中重复出现' };
          pending.push(p);
          return;
        }
        replacementIdsInFile.add(sourceRowId);
        p.replacesOrderRowId = sourceRowId;
      }

      const provinceName = raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['省份名称']];
      const cityName = raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['地市名称']];
      const contractNo = raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['合同编号']];
      const orderTimeRaw = raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['下单时间']];
      const amountRaw = raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['含税总金额']];

      const provinceId = provinceName ? provinceByName.get(this.normalizeProvinceName(provinceName)) : undefined;
      if (!provinceName || !provinceId) { p.error = { type: 'province', field: '省份名称', message: `省份「${provinceName || ''}」无法映射` }; pending.push(p); return; }
      p.provinceId = provinceId;
      // 行级数据范围校验（按上传时快照）
      const cityId = cityName
        ? cityByProvinceName.get(`${provinceId}|${this.normalizeRawCityName(cityName)}`)
          ?? cityByProvinceName.get(`${provinceId}|${this.normalizeCityName(cityName)}`)
        : undefined;
      const scopeErr = this.assertRowScope(batch.dataScopeJson, provinceId, cityId);
      if (scopeErr) { p.error = { type: 'scope', field: '省份名称', message: scopeErr }; pending.push(p); return; }

      if (!cityName || !cityId) { p.error = { type: 'city', field: '地市名称', message: `地市「${cityName || ''}」无法映射到省份` }; pending.push(p); return; }
      p.cityId = cityId;

      const contract = contractNo ? contractByNo.get(contractNo) : undefined;
      if (!contractNo || !contract) { p.error = { type: 'contract', field: '合同编号', message: `合同「${contractNo || ''}」不存在` }; pending.push(p); return; }
      p.contractId = contract.id;
      if (contract.provinceId !== provinceId) { p.error = { type: 'contract', field: '合同编号', message: `合同「${contractNo}」不属于该省份` }; pending.push(p); return; }

      if (!allocSet.has(`${contract.id}|${cityId}`)) { p.error = { type: 'alloc', field: '地市名称', message: `合同「${contractNo}」未分配该地市` }; pending.push(p); return; }

      const orderTime = this.parseOrderTime(orderTimeRaw);
      if (!orderTime) { p.error = { type: 'time', field: '下单时间', message: `下单时间「${orderTimeRaw || ''}」无法解析` }; pending.push(p); return; }
      p.orderTimeStd = orderTime;
      p.businessMonth = `${orderTime.getFullYear()}-${String(orderTime.getMonth() + 1).padStart(2, '0')}`;

      // F 列金额：空/非数值 → 错误；正/零/负全部入账（DEV-034）
      const amount = this.parseOrderAmount(amountRaw);
      if (!Number.isFinite(amount)) { p.error = { type: 'amount', field: '含税总金额', message: `金额「${amountRaw}」不是有效数值` }; pending.push(p); return; }
      p.completionAmountFen = Math.round(amount * 100);

      // 费率快照：≤ 业务月份的最大生效费率；缺失费率按 0 计入，不阻断该行及同批次其他正常行。
      const rates = feeRatesByContractCity.get(`${contract.id}|${cityId}`) ?? [];
      const effective = rates.filter((r) => r.effectiveMonth <= p.businessMonth!).sort((a, b) => b.effectiveMonth.localeCompare(a.effectiveMonth))[0];
      p.feeRateSnapshotBp = effective?.rateBp ?? 0;
      p.grossProfitFen = Math.round((p.completionAmountFen * p.feeRateSnapshotBp) / 10000);

      pending.push(p);
    });

    for (const p of pending) if (p.error) errors.push({ type: p.error.type, rowNo: p.sourceRowNo, field: p.error.field, message: p.error.message });

    // 4. 原始行、错误、接替关系与上传记录状态必须原子提交。
    batch.totalRows = pending.length;
    batch.importedRows = pending.filter((p) => !p.error).length;
    batch.failureReason = errors.length > 0 ? `已保存全部 ${pending.length} 行，其中 ${errors.length} 行待维护` : null;
    await this.dataSource.transaction(async (manager) => {
      // Serialize activations and corrections across instances, including when no snapshot exists yet.
      await manager.query('UPDATE biz_order_snapshot_lock SET revision = revision + 1 WHERE id = 1');
      if (batch.batchPurpose === 'correction') {
        const currentSource = await manager.countBy(BizOrderRowEntity, { batchId: batch.sourceBatchId!, isCurrent: true });
        if (!currentSource) throw new BadRequestException('来源批次已被最新总表替换，请下载当前批次的待维护订单');
      }
      if (errors.length > 0) {
        const entities = errors.map((e) => ({
          id: randomUUID(), batchId, errorType: e.type, rowNo: e.rowNo, field: e.field, message: e.message,
        }));
        for (let i = 0; i < entities.length; i += 300) {
          await manager.insert(BizOrderImportErrorEntity, entities.slice(i, i + 300));
        }
      }
      // SQLite/MySQL 变量数上限：300 行 × ~60 列 = 18k 参数，兼容 SQLITE_MAX_VARIABLE_NUMBER
      const chunk = 300;
      for (let i = 0; i < pending.length; i += chunk) {
        const slice = pending.slice(i, i + chunk);
        await manager.createQueryBuilder().insert().into(BizOrderRowEntity).values(
          slice.map((p) => ({
            id: randomUUID(),
            batchId,
            sourceRowNo: p.sourceRowNo,
            provinceName: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['省份名称']] || null,
            cityName: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['地市名称']] || null,
            purchaseOrderNo: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['采购订单编号']] || null,
            supplierName: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['供应商名称']] || null,
            orderMainStatus: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['订单主状态']] || null,
            taxInclusiveAmountRaw: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['含税总金额']] || null,
            materialName: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['物料名称']] || null,
            materialCode: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['物料编码']] || null,
            contractNoRaw: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['合同编号']] || null,
            netPriceRaw: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['净价']] || null,
            freightRaw: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['运保费']] || null,
            constructionRaw: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['建安费']] || null,
            feeType: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['费用类型']] || null,
            taxRateRaw: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['税率']] || null,
            taxAmountRaw: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['税额']] || null,
            taxInclusiveUnitPriceRaw: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['含税单价']] || null,
            quantityRaw: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['采购数量']] || null,
            unit: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['计量单位']] || null,
            receiverNameEnc: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['收货人']] || null,
            receiverPhoneEnc: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['收货人联系方式']] || null,
            receiverAddressEnc: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['收货人详细地址']] || null,
            notifier: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['通知人']] || null,
            orderTimeRaw: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['下单时间']] || null,
            noticeTimeRaw: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['通知时间']] || null,
            postscript: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['附言信息']] || null,
            projectCode: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['项目编号']] || null,
            projectName: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['项目名称']] || null,
            siteCode: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['站址编号']] || null,
            siteInfo: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['站址信息']] || null,
            receiptStatus: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['收货状态']] || null,
            productName: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['商品名称']] || null,
            productCode: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['商品编号']] || null,
            sourceTagFlag: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['物料源头贴签标识']] || null,
            resampleFlag: p.raw[ORDER_TEMPLATE_COLUMN_INDEX_MAP['是否补样订单']] || null,
            provinceId: p.provinceId,
            cityId: p.cityId,
            contractId: p.contractId,
            orderTimeStd: p.orderTimeStd,
            businessMonth: p.businessMonth,
            completionAmountFen: p.completionAmountFen,
            feeRateSnapshotBp: p.feeRateSnapshotBp,
            grossProfitFen: p.grossProfitFen,
            cityOverrunFlag: false,
            contractOverrunFlag: false,
            isVoid: false,
            sourceRowJson: p.raw,
            validationStatus: p.error ? 'needs_review' : 'valid',
            isCurrent: true,
            validationError: p.error?.message ?? null,
            replacesOrderRowId: p.replacesOrderRowId,
          })),
        ).execute();
      }
      if (batch.batchPurpose === 'correction') {
        const replaceIds = pending.filter((p) => p.replacesOrderRowId).map((p) => p.replacesOrderRowId as string);
        if (replaceIds.length > 0) {
          const replaced = await manager.createQueryBuilder()
            .update(BizOrderRowEntity)
            .set({
              validationStatus: 'superseded', resolvedByBatchId: batch.id,
              resolvedByUserId: batch.uploadedBy, resolvedAt: new Date(),
            })
            .where('id IN (:...replaceIds)', { replaceIds })
            .andWhere('batch_id = :sourceBatchId', { sourceBatchId: batch.sourceBatchId ?? '' })
            .andWhere('validation_status = :reviewStatus', { reviewStatus: 'needs_review' })
            .andWhere('resolved_by_batch_id IS NULL')
            .execute();
          if ((replaced.affected ?? 0) !== replaceIds.length) {
            throw new Error('来源订单行已被其他修正上传接替，请重新下载最新待维护文件');
          }
        }
      }
      if (batch.batchPurpose === 'normal') {
        const newer = await manager.createQueryBuilder(BizOrderImportBatchEntity, 'b')
          .where('b.lifecycleStatus = :current', { current: 'current' })
          .andWhere('b.batchPurpose = :normal', { normal: 'normal' })
          .andWhere('b.uploadedAt > :uploadedAt', { uploadedAt: batch.uploadedAt }).getCount();
        if (newer) throw new BadRequestException('更新的全量批次已生效，本批次取消替换');
        await manager.createQueryBuilder().update(BizOrderRowEntity).set({ isCurrent: false })
          .where('is_current = 1 AND batch_id <> :batchId', { batchId }).execute();
        await manager.createQueryBuilder().update(BizOrderImportBatchEntity).set({ lifecycleStatus: 'historical' })
          .where('lifecycle_status = :current', { current: 'current' }).execute();
      }
      batch.lifecycleStatus = 'current';
      batch.status = OrderBatchStatus.IMPORTED;
      await manager.save(batch);
      if (this.dataSource.hasMetadata(BizSnapshotRegistryEntity)) {
        await manager.update(BizSnapshotRegistryEntity, { status: 'ready' }, { status: 'stale' });
      }
    });

    this.cleanupTempFile(batch);
    await this.recordOp(batch.uploadedBy, 'order_snapshot.activate', batch.id);
    // M6：明细变更触发增量重算（失败仅记录不阻断）
    void this.aggregates.recalcInternal({}).catch(() => {});
  }

  /** 行级数据范围校验：上传人超范围行拒绝（super=all 不限；province=行省份 ∈ provinceIds；city=行地市=绑定地市） */
  private assertRowScope(scopeJson: string | null, provinceId: string, cityId: string | undefined): string | null {
    if (!scopeJson) return null;
    let scope: { roleCode?: string; scopeType?: string; provinceIds?: string[]; cityIds?: string[]; cityId?: string | null };
    try { scope = JSON.parse(scopeJson); } catch { return null; }
    if (scope.scopeType === 'all') return null;
    if (scope.scopeType === 'province') {
      if (!scope.provinceIds || scope.provinceIds.length === 0) return null;
      return scope.provinceIds.includes(provinceId) ? null : '上传人数据范围不包含该省份';
    }
    if (scope.scopeType === 'city') {
      const allowedCityIds = scope.cityIds?.length ? scope.cityIds : (scope.cityId ? [scope.cityId] : []);
      return cityId && allowedCityIds.includes(cityId) ? null : '上传人数据范围不包含该地市';
    }
    if (scope.scopeType === 'contract') return '当前账号无订单数据范围';
    return null;
  }

  /** 批次失败：零写入（从未插入行）→ 状态 FAILED + 错误报告 + 删除临时文件 */
  private async failBatch(batchId: string, reason: string, errors: Array<{ type: string; rowNo: number | null; field: string | null; message: string }> = []): Promise<void> {
    const batch = await this.batchRepo.findOneBy({ id: batchId });
    if (!batch || batch.status !== OrderBatchStatus.PARSING) return;
    if (errors.length > 0) {
      // 错误报告分块保存，避免超 SQLite/MySQL 变量数上限（7 万行级失败文件）
      const entities = errors.map((e) => ({
        id: randomUUID(), batchId, errorType: e.type, rowNo: e.rowNo, field: e.field, message: e.message,
      }));
      for (let i = 0; i < entities.length; i += 300) {
        await this.errorRepo.save(entities.slice(i, i + 300));
      }
    }
    batch.status = OrderBatchStatus.FAILED;
    batch.failureReason = reason.slice(0, 2000);
    await this.batchRepo.save(batch);
    this.cleanupTempFile(batch);
  }

  /** 删除临时文件（任务结束），保留路径供异常审计 */
  private cleanupTempFile(batch: BizOrderImportBatchEntity): void {
    if (batch.tempFilePath && existsSync(batch.tempFilePath)) {
      rmSync(batch.tempFilePath, { force: true });
    }
  }

  /** 结构校验：单工作表 + 34 列 + 表头逐一严格匹配 */
  private resolveColumnIndexes(wb: XLSX.WorkBook): Map<string, number> | string {
    if (wb.SheetNames.length !== ORDER_TEMPLATE_SHEET_COUNT) {
      return `文件必须包含 ${ORDER_TEMPLATE_SHEET_COUNT} 个工作表（当前 ${wb.SheetNames.length}）`;
    }
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, range: 'A1:AZ1', raw: true, defval: '' });
    const header = (rows[0] ?? []).map((v) => String(v).trim());
    if (header.length === 0) return '文件缺少表头行';
    const aliases = new Map<string, string[]>([
      [ORDER_TEMPLATE_COLUMNS[0], [ORDER_TEMPLATE_COLUMNS[0], '省份', '省份名称']],
      [ORDER_TEMPLATE_COLUMNS[1], [ORDER_TEMPLATE_COLUMNS[1], '地市', '城市', '地市名称']],
      [ORDER_TEMPLATE_COLUMNS[2], [ORDER_TEMPLATE_COLUMNS[2], '订单编号', '采购订单号']],
      [ORDER_TEMPLATE_COLUMNS[5], [ORDER_TEMPLATE_COLUMNS[5], '含税金额', '订单含税金额', '订单金额']],
      [ORDER_TEMPLATE_COLUMNS[8], [ORDER_TEMPLATE_COLUMNS[8], '合同号', '合同编号']],
      [ORDER_TEMPLATE_COLUMNS[22], [ORDER_TEMPLATE_COLUMNS[22], '订单时间', '下单日期']],
    ]);
    const normalizedHeader = header.map((value) => this.normalizeHeader(value));
    const indexes = new Map<string, number>();
    for (const column of ORDER_TEMPLATE_COLUMNS) {
      const names = aliases.get(column) ?? [column];
      const index = normalizedHeader.findIndex((value) => names.some((name) => value === this.normalizeHeader(name)));
      if (index >= 0) indexes.set(column, index);
    }
    const required = [ORDER_TEMPLATE_COLUMNS[0], ORDER_TEMPLATE_COLUMNS[1], ORDER_TEMPLATE_COLUMNS[5], ORDER_TEMPLATE_COLUMNS[8], ORDER_TEMPLATE_COLUMNS[22]];
    const missing = required.filter((column) => !indexes.has(column));
    if (missing.length > 0) return `缺少入账关键列：${missing.join('、')}`;
    return indexes;
  }

  private normalizeHeader(value: string): string {
    return value.replace(/\s/g, '').replace(/\(/g, '（').replace(/\)/g, '）').toLowerCase();
  }

  private normalizeProvinceName(value: string): string {
    return value.trim()
      .replace(/\s/g, '')
      .replace(/(?:特别行政区|维吾尔自治区|回族自治区|壮族自治区|自治区|省|市)$/, '')
      .toLowerCase();
  }

  private provinceNameAliases(name: string, code: string): string[] {
    const normalizedName = this.normalizeProvinceName(name);
    const normalizedCode = code.trim().toLowerCase();
    return [...new Set([normalizedName, normalizedCode])].filter(Boolean);
  }

  private parseOrderAmount(raw: string): number {
    const normalized = raw.trim().replace(/[￥¥元,，\s]/g, '');
    return normalized === '' ? Number.NaN : Number(normalized);
  }

  private stringifyOrderCell(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (value instanceof Date) {
      const year = value.getFullYear();
      const month = String(value.getMonth() + 1).padStart(2, '0');
      const day = String(value.getDate()).padStart(2, '0');
      const hour = String(value.getHours()).padStart(2, '0');
      const minute = String(value.getMinutes()).padStart(2, '0');
      const second = String(value.getSeconds()).padStart(2, '0');
      return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
    }
    return String(value).trim();
  }

  /** Normalize city-company labels such as "XX市公司" and "XX市分公司". */
  private normalizeCityName(value: string): string {
    return value.trim().replace(/\s/g, '').replace(/(?:分)?公司$/, '');
  }

  private normalizeRawCityName(value: string): string {
    return value.trim().replace(/\s/g, '').toLowerCase();
  }

  private cityNameAliases(value: string): string[] {
    const normalized = this.normalizeCityName(value);
    if (!normalized) return [];
    const withoutSuffix = normalized.endsWith('市') ? normalized.slice(0, -1) : normalized;
    return [...new Set([normalized, withoutSuffix, `${withoutSuffix}市`])];
  }

  private resolveCorrectionIndexes(wb: XLSX.WorkBook): { sourceBatch?: number; sourceRow?: number } {
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, range: 'A1:AZ1', raw: true, defval: '' });
    const header = (rows[0] ?? []).map((v) => this.normalizeHeader(String(v)));
    const indexOf = (value: string): number | undefined => {
      const index = header.indexOf(this.normalizeHeader(value));
      return index >= 0 ? index : undefined;
    };
    return { sourceBatch: indexOf(CORRECTION_SOURCE_BATCH_HEADER), sourceRow: indexOf(CORRECTION_SOURCE_ROW_HEADER) };
  }

  private cellFromRow(row: string[], index: number | undefined): string {
    return index === undefined ? '' : String(row[index] ?? '').trim();
  }

  private correctionSourceRowId(row: string[], indexes: { sourceRow?: number }): string | null {
    const value = this.cellFromRow(row, indexes.sourceRow);
    return value || null;
  }

  private async loadCorrectionSourceRows(sourceBatchId: string | null, scopeJson: string | null): Promise<Map<string, BizOrderRowEntity>> {
    if (!sourceBatchId) throw new BadRequestException('修正批次缺少来源批次');
    const rows = await this.rowRepo.find({ where: { batchId: sourceBatchId, validationStatus: 'needs_review' } });
    const result = new Map<string, BizOrderRowEntity>();
    for (const row of rows) {
      if (row.resolvedByBatchId || !this.rowMatchesScopeSnapshot(row, scopeJson)) continue;
      result.set(row.id, row);
    }
    return result;
  }

  private rowMatchesScopeSnapshot(row: BizOrderRowEntity, scopeJson: string | null): boolean {
    if (!scopeJson) return true;
    let scope: { scopeType?: string; provinceIds?: string[]; cityIds?: string[]; cityId?: string | null };
    try { scope = JSON.parse(scopeJson) as { scopeType?: string; provinceIds?: string[]; cityId?: string | null }; }
    catch { return false; }
    if (scope.scopeType === 'all') return true;
    if (scope.scopeType === 'province') {
      return !scope.provinceIds?.length || (row.provinceId != null && scope.provinceIds.includes(row.provinceId));
    }
    if (scope.scopeType === 'city') {
      const allowedCityIds = scope.cityIds?.length ? scope.cityIds : (scope.cityId ? [scope.cityId] : []);
      return row.cityId != null && allowedCityIds.includes(row.cityId);
    }
    return false;
  }

  private assertTemplateStructure(wb: XLSX.WorkBook): string | null {
    if (wb.SheetNames.length !== ORDER_TEMPLATE_SHEET_COUNT) {
      return `文件必须包含 ${ORDER_TEMPLATE_SHEET_COUNT} 个工作表（当前 ${wb.SheetNames.length}）`;
    }
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' });
    const header = (rows[0] ?? []).map((v) => String(v).trim());
    if (header.length !== ORDER_TEMPLATE_COLUMN_COUNT) {
      return `表头列数 ${header.length} 不等于 ${ORDER_TEMPLATE_COLUMN_COUNT}`;
    }
    for (let i = 0; i < ORDER_TEMPLATE_COLUMN_COUNT; i++) {
      if (header[i] !== ORDER_TEMPLATE_COLUMNS[i]) {
        return `第 ${i + 1} 列表头「${header[i]}」与冻结模板「${ORDER_TEMPLATE_COLUMNS[i]}」不一致`;
      }
    }
    return null;
  }

  /** 解析下单时间（兼容 Excel 日期序列号/字符串） */
  private parseOrderTime(raw: string): Date | null {
    if (!raw) return null;
    const trimmed = raw.trim();
    // 字符串日期
    if (/^\d{4}[-/.]/.test(trimmed)) {
      const parsed = new Date(trimmed.replace(/[.\/]/g, '-'));
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    // Excel 日期序列号（25569 = 1970-01-01 的 Excel 序列号）
    const num = Number(trimmed);
    if (Number.isFinite(num) && num > 20000 && num < 60000) {
      return new Date(Math.round((num - 25569) * 86400 * 1000));
    }
    return null;
  }

  /** 提取文件内最大下单时间（防重第二指纹） */
  private extractMaxOrderTime(wb: XLSX.WorkBook): Date | null {
    if (wb.SheetNames.length !== 1) return null;
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' });
    const resolved = this.resolveColumnIndexes(wb);
    if (typeof resolved === 'string') return null;
    const colIdx = resolved.get(ORDER_TEMPLATE_COLUMNS[22]);
    if (colIdx === undefined) return null;
    let max: Date | null = null;
    for (let i = 1; i < rows.length; i++) {
      const cell = rows[i]?.[colIdx];
      const raw = cell === null || cell === undefined ? '' : String(cell).trim();
      const d = this.parseOrderTime(raw);
      if (d && (!max || d.getTime() > max.getTime())) max = d;
    }
    return max;
  }

  // ================= 查询与作废/恢复 =================

  private async visibleCityIds(auth: BizAuthContext): Promise<string[] | null> {
    if (auth.isSuperAdmin || auth.dataScope.scopeType === 'all') return null;
    if (auth.dataScope.scopeType === 'contract') throw new ForbiddenException('当前账号无订单数据范围');
    if (auth.dataScope.scopeType === 'city') return auth.dataScope.cityIds?.length ? auth.dataScope.cityIds : (auth.dataScope.cityId ? [auth.dataScope.cityId] : []);
    if (auth.dataScope.provinceIds.length === 0) return null;
    const cities = await this.cityRepo.find({ where: { provinceId: In(auth.dataScope.provinceIds) } });
    return cities.map((city) => city.id);
  }

  async listBatches(auth: BizAuthContext): Promise<BizOrderImportBatchEntity[]> {
    const cityIds = await this.visibleCityIds(auth);
    const qb = this.batchRepo.createQueryBuilder('b').orderBy('b.createdAt', 'DESC');
    if (cityIds) {
      if (cityIds.length === 0) return [];
      qb.innerJoin(BizOrderRowEntity, 'r', 'r.batch_id = b.id')
        .andWhere('r.city_id IN (:...visibleCityIds)', { visibleCityIds: cityIds })
        .distinct(true);
    }
    const batches = await qb.getMany();
    const uploaderIds = [...new Set(batches.map((batch) => batch.uploadedBy).filter(Boolean))];
    if (uploaderIds.length === 0) return batches;
    const users = await this.userRepo.find({
      where: { id: In(uploaderIds) },
      select: ['id', 'username'],
    });
    const usernames = new Map(users.map((user) => [user.id, user.username]));
    return batches.map((batch) => ({
      ...batch,
      uploadedBy: usernames.get(batch.uploadedBy) ?? batch.uploadedBy,
    }));
  }

  async batchDetail(auth: BizAuthContext, id: string): Promise<{ batch: BizOrderImportBatchEntity; errors: BizOrderImportErrorEntity[]; rowCount: number }> {
    const batch = await this.batchRepo.findOneBy({ id });
    if (!batch) throw new NotFoundException('批次不存在');
    // 上传者可查看自己上传的批次（含失败批次）；其余用户按数据范围收敛
    const isUploader = batch.uploadedBy === auth.userId;
    if (!isUploader) {
      const cityIds = await this.visibleCityIds(auth);
      if (cityIds) {
        if (cityIds.length === 0) throw new ForbiddenException('数据范围不足');
        const visibleRow = await this.rowRepo.createQueryBuilder('r')
          .where('r.batch_id = :batchId', { batchId: id })
          .andWhere('r.city_id IN (:...visibleCityIds)', { visibleCityIds: cityIds })
          .getOne();
        if (!visibleRow) throw new ForbiddenException('数据范围不足');
      }
    }
    const errors = await this.errorRepo.findBy({ batchId: id });
    const rowCount = await this.rowRepo.countBy({ batchId: id });
    // 范围收敛：非上传者且数据范围受限时，只返回可见城市行数，不返回范围外错误/数量（防止混合批次统计泄露）
    if (!isUploader && auth.dataScope.scopeType !== 'all' && auth.dataScope.scopeType !== 'contract') {
      const cityIds = await this.visibleCityIds(auth);
      const visibleRows = cityIds
        ? await this.rowRepo.createQueryBuilder('r')
            .where('r.batch_id = :batchId', { batchId: id })
            .andWhere('r.city_id IN (:...visibleCityIds)', { visibleCityIds: cityIds })
            .getCount()
        : rowCount;
      return { batch: { ...batch, totalRows: visibleRows, importedRows: visibleRows, rowCountScoped: true } as BizOrderImportBatchEntity, errors: [], rowCount: visibleRows };
    }
    return { batch, errors, rowCount };
  }

  async exportReviewFile(auth: BizAuthContext, id: string, sensitive: boolean): Promise<{ filename: string; buffer: Buffer }> {
    const detail = await this.batchDetail(auth, id);
    const batch = detail.batch;
    const visibleCityIds = await this.visibleCityIds(auth);
    const rowQuery = this.rowRepo.createQueryBuilder('r')
      .where('r.batch_id = :batchId', { batchId: id })
      .andWhere('r.validation_status = :reviewStatus', { reviewStatus: 'needs_review' })
      .orderBy('r.source_row_no', 'ASC');
    if (visibleCityIds) {
      if (visibleCityIds.length === 0) throw new ForbiddenException('数据范围不足');
      rowQuery.andWhere('r.city_id IN (:...visibleCityIds)', { visibleCityIds });
    }
    const rows = await rowQuery.getMany();
    if (rows.length === 0) throw new BadRequestException('该批次没有可下载的待维护订单');
    const errorByRow = new Map(detail.errors.filter((item) => item.rowNo != null).map((item) => [Number(item.rowNo), item.message]));
    const headers = [...ORDER_TEMPLATE_COLUMNS, ...CORRECTION_HEADERS];
    const values = rows.map((row) => {
      const raw = this.rawValuesFromRow(row, sensitive);
      return [
        ...raw,
        batch.id,
        row.id,
        row.sourceRowNo,
        errorByRow.get(row.sourceRowNo) ?? row.validationError ?? '',
      ];
    });
    const sheet = XLSX.utils.aoa_to_sheet([headers, ...values]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, '待维护订单');
    return {
      filename: `订单待维护-${batch.id.slice(0, 8)}.xlsx`,
      buffer: Buffer.from(XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' })),
    };
  }

  private rawValuesFromRow(row: BizOrderRowEntity, sensitive: boolean): string[] {
    const sourceValues = row.sourceRowJson?.slice(0, ORDER_TEMPLATE_COLUMN_COUNT) ?? [];
    const fallback = new Array<string>(ORDER_TEMPLATE_COLUMN_COUNT).fill('');
    for (let index = 0; index < sourceValues.length; index += 1) fallback[index] = String(sourceValues[index] ?? '');
    fallback[0] = row.provinceName ?? '';
    fallback[1] = row.cityName ?? '';
    fallback[2] = row.purchaseOrderNo ?? '';
    fallback[3] = row.supplierName ?? '';
    fallback[4] = row.orderMainStatus ?? '';
    fallback[5] = row.taxInclusiveAmountRaw ?? '';
    fallback[8] = row.contractNoRaw ?? '';
    fallback[18] = row.receiverNameEnc ?? '';
    fallback[19] = row.receiverPhoneEnc ?? '';
    fallback[20] = row.receiverAddressEnc ?? '';
    fallback[22] = row.orderTimeRaw ?? '';
    if (!sensitive) {
      for (const index of ORDER_TEMPLATE_SENSITIVE_COLUMN_INDEXES_0BASED) {
        if (index === 18) fallback[index] = this.maskName(fallback[index]);
        if (index === 19) fallback[index] = this.maskPhone(fallback[index]) ?? '';
        if (index === 20) fallback[index] = this.maskAddress(fallback[index]) ?? '';
      }
    }
    return fallback;
  }

  /** Re-validate a retained raw row after an administrator fixes normalized reference data. */
  async maintainRow(auth: BizAuthContext, id: string, input: MaintainOrderRowInput): Promise<Record<string, unknown>> {
    const row = await this.rowRepo.findOneBy({ id });
    if (!row) throw new NotFoundException('订单行不存在');
    if (!row.isCurrent) throw new BadRequestException('历史批次不能维护，请使用当前生效批次');
    const batch = await this.batchRepo.findOneBy({ id: row.batchId });
    if (!batch) throw new NotFoundException('导入批次不存在');
    if (batch.status !== OrderBatchStatus.IMPORTED) throw new BadRequestException('仅已导入批次可以维护');
    const provinceId = input.provinceId?.trim();
    const cityId = input.cityId?.trim();
    const contractId = input.contractId?.trim();
    const businessMonth = input.businessMonth?.trim();
    if (!provinceId || !cityId || !contractId || !businessMonth) {
      throw new BadRequestException('省份、地市、合同和业务月份均不能为空');
    }
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(businessMonth)) throw new BadRequestException('业务月份格式应为 YYYY-MM');

    const [province, city, contract, allocation] = await Promise.all([
      this.provinceRepo.findOneBy({ id: provinceId }),
      this.cityRepo.findOneBy({ id: cityId }),
      this.contractRepo.findOneBy({ id: contractId }),
      this.allocRepo.findOneBy({ contractId, cityId, status: 'active' }),
    ]);
    if (!province) throw new BadRequestException('省份不存在');
    if (!city || city.provinceId !== provinceId) throw new BadRequestException('地市不属于所选省份');
    if (!contract) throw new BadRequestException('合同不存在');
    if (contract.provinceId !== provinceId) throw new BadRequestException('合同不属于所选省份');
    if (!allocation) throw new BadRequestException('合同尚未分配所选地市');

    const amount = this.parseOrderAmount(String(row.taxInclusiveAmountRaw ?? ''));
    const errors: Array<{ type: string; field: string; message: string }> = [];
    if (!Number.isFinite(amount)) errors.push({ type: 'amount', field: '含税总金额', message: `金额“${row.taxInclusiveAmountRaw ?? ''}”不是有效数值` });
    let rateBp: number | null = input.feeRateSnapshotBp ?? null;
    if (rateBp == null) {
      const effective = await this.contracts.getEffectiveRate(contractId, cityId, businessMonth);
      rateBp = effective?.rateBp ?? 0;
    }
    if (!Number.isInteger(rateBp) || rateBp < 0 || rateBp > 10000) {
      errors.push({ type: 'rate', field: '管理费率', message: '管理费率必须在 0% 到 100% 之间' });
      rateBp = null;
    }
    const completionAmountFen = Number.isFinite(amount) ? Math.round(amount * 100) : null;
    const grossProfitFen = completionAmountFen != null && rateBp != null ? Math.round((completionAmountFen * rateBp) / 10000) : null;
    const validationError = errors.length > 0 ? errors.map((error) => error.message).join('；') : null;
    await this.dataSource.transaction(async (manager) => {
      await manager.query('UPDATE biz_order_snapshot_lock SET revision = revision + 1 WHERE id = 1');
      if (!await manager.countBy(BizOrderRowEntity, { id, isCurrent: true })) {
        throw new BadRequestException('订单已被最新总表替换，请刷新后重试');
      }
      row.provinceId = provinceId;
      row.cityId = cityId;
      row.contractId = contractId;
      row.businessMonth = businessMonth;
      row.feeRateSnapshotBp = rateBp;
      row.completionAmountFen = completionAmountFen;
      row.grossProfitFen = grossProfitFen;
      row.validationStatus = errors.length > 0 ? 'needs_review' : 'valid';
      row.validationError = validationError;
      await manager.save(row);
      await manager.delete(BizOrderImportErrorEntity, { batchId: row.batchId, rowNo: row.sourceRowNo });
      if (errors.length > 0) {
        await manager.insert(BizOrderImportErrorEntity, errors.map((error) => ({
          id: randomUUID(), batchId: row.batchId, rowNo: row.sourceRowNo,
          errorType: error.type, field: error.field, message: error.message,
        })));
      }
      const reviewCount = await manager.countBy(BizOrderRowEntity, { batchId: row.batchId, validationStatus: 'needs_review' });
      batch.importedRows = Math.max(0, batch.totalRows - reviewCount);
      batch.failureReason = reviewCount > 0 ? `已保存全部 ${batch.totalRows} 行，其中 ${reviewCount} 行待维护` : null;
      await manager.save(batch);
    });
    // Keep the raw source immutable; the operation log records the maintenance event.
    await this.opLogRepo.save({
      id: randomUUID(), operatorUserId: auth.userId, actionType: 'order_row.maintain',
      targetType: 'order_row', targetId: row.id, resultStatus: errors.length > 0 ? 'needs_review' : 'success',
    });
    void this.aggregates.recalcInternal({}).catch(() => {});
    return this.listRow(
      row,
      true,
      new Map([[city.id, city.name]]),
      new Map([[contract.id, { contractNo: contract.contractNo, contractName: contract.contractName }]]),
    );
  }

  /** 批次作废（仅 super_admin）：原始行 is_void=true 退出统计；保留行/账号/时间 */
  /** Delete only failed batches so a failed import can be retried without changing imported data. */
  async deleteFailedBatch(auth: BizAuthContext, id: string): Promise<void> {
    const batch = await this.batchRepo.findOneBy({ id });
    if (!batch) throw new NotFoundException('批次不存在');
    if (batch.status !== OrderBatchStatus.FAILED) {
      throw new BadRequestException('仅导入失败批次可删除，已入账批次不可删除');
    }
    if (!auth.isSuperAdmin && batch.uploadedBy !== auth.userId) {
      throw new ForbiddenException('管理员仅可删除自己上传的失败批次');
    }
    const rowCount = await this.rowRepo.countBy({ batchId: id });
    if (rowCount > 0) {
      throw new BadRequestException('失败批次包含已入账数据，禁止删除');
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(BizOrderImportErrorEntity, { batchId: id });
      await manager.delete(BizOrderImportBatchEntity, { id });
    });
    this.cleanupTempFile(batch);
    await this.recordOp(auth.userId, 'order_batch.delete_failed', id);
  }

  async voidBatch(auth: BizAuthContext, id: string, reason: string): Promise<void> {
    if (!reason?.trim()) throw new BadRequestException('作废原因必填');
    const batch = await this.batchRepo.findOneBy({ id });
    if (!batch) throw new NotFoundException('批次不存在');
    if (batch.status !== OrderBatchStatus.IMPORTED) throw new BadRequestException('仅已导入批次可作废');
    await this.dataSource.transaction(async (manager) => {
      await manager.update(BizOrderRowEntity, { batchId: id }, { isVoid: true, voidReason: reason });
      batch.status = OrderBatchStatus.VOIDED;
      batch.voidedBy = auth.userId;
      batch.voidedAt = new Date();
      batch.voidReason = reason;
      await manager.save(batch);
    });
    await this.recordOp(auth.userId, 'order_batch.void', id);
    void this.aggregates.recalcInternal({}).catch(() => {});
  }

  /** 批次恢复（仅 super_admin）：恢复原始行统计 */
  async restoreBatch(auth: BizAuthContext, id: string): Promise<void> {
    const batch = await this.batchRepo.findOneBy({ id });
    if (!batch) throw new NotFoundException('批次不存在');
    if (batch.status !== OrderBatchStatus.VOIDED) throw new BadRequestException('仅已作废批次可恢复');
    await this.dataSource.transaction(async (manager) => {
      await manager.update(BizOrderRowEntity, { batchId: id }, { isVoid: false, voidReason: null });
      batch.status = OrderBatchStatus.IMPORTED;
      batch.voidedBy = null;
      batch.voidedAt = null;
      batch.voidReason = null;
      batch.restoredAt = new Date();
      await manager.save(batch);
    });
    await this.recordOp(auth.userId, 'order_batch.restore', id);
    void this.aggregates.recalcInternal({}).catch(() => {});
  }

  /** 订单行列表（敏感列脱敏：无 SENSITIVE_ORDER_PERMISSION 时遮罩） */
  async listRows(auth: BizAuthContext, filter: { batchId?: string; cityId?: string; overrun?: 'city' | 'contract' | 'any'; validationStatus?: 'valid' | 'needs_review'; page?: number; pageSize?: number }, sensitive: boolean) {
    const cityIds = await this.visibleCityIds(auth);
    const qb = this.rowRepo.createQueryBuilder('r');
    if (cityIds) {
      if (cityIds.length === 0) return { items: [], total: 0, page: 1, pageSize: 500 };
      if (filter.cityId && !cityIds.includes(filter.cityId)) throw new ForbiddenException('数据范围不足');
      qb.andWhere('r.city_id IN (:...visibleCityIds)', { visibleCityIds: cityIds });
    }
    if (filter.batchId) qb.andWhere('r.batchId = :batchId', { batchId: filter.batchId });
    else qb.andWhere('r.isCurrent = 1');
    if (filter.cityId) qb.andWhere('r.cityId = :cityId', { cityId: filter.cityId });
    if (filter.overrun === 'city') qb.andWhere('r.cityOverrunFlag = 1');
    if (filter.overrun === 'contract') qb.andWhere('r.contractOverrunFlag = 1');
    if (filter.overrun === 'any') qb.andWhere('(r.cityOverrunFlag = 1 OR r.contractOverrunFlag = 1)');
    if (filter.validationStatus) qb.andWhere('r.validationStatus = :validationStatus', { validationStatus: filter.validationStatus });
    const total = await qb.getCount();
    const pageSize = Math.min(500, Math.max(1, Math.trunc(filter.pageSize ?? 500)));
    const page = Math.max(1, Math.trunc(filter.page ?? 1));
    const rows = await qb.orderBy('r.sourceRowNo', 'ASC').skip((page - 1) * pageSize).take(pageSize).getMany();
    const cityNames = new Map((await this.cityRepo.find()).map((city) => [city.id, city.name]));
    const contractIds = [...new Set(rows.map((row) => row.contractId).filter((id): id is string => Boolean(id)))];
    const contracts = contractIds.length > 0
      ? await this.contractRepo.find({ where: { id: In(contractIds) } })
      : [];
    const contractNames = new Map(contracts.map((contract) => [contract.id, {
      contractNo: contract.contractNo,
      contractName: contract.contractName,
    }]));
    return { items: rows.map((r) => this.listRow(r, sensitive, cityNames, contractNames)), total, page, pageSize };
  }

  private listRow(
    r: BizOrderRowEntity,
    sensitive: boolean,
    cityNames: Map<string, string>,
    contractNames: Map<string, { contractNo: string; contractName: string }>,
  ): Record<string, unknown> {
    const contract = r.contractId ? contractNames.get(r.contractId) : undefined;
    return {
      id: r.id,
      batchId: r.batchId,
      sourceRowNo: r.sourceRowNo,
      purchaseOrderNo: r.purchaseOrderNo,
      supplierName: r.supplierName,
      projectName: r.projectName,
      provinceId: r.provinceId,
      cityId: r.cityId,
      contractId: r.contractId,
      contractNo: contract?.contractNo ?? null,
      contractName: contract?.contractName ?? null,
      cityName: r.cityId ? cityNames.get(r.cityId) ?? r.cityName : r.cityName,
      provinceName: r.provinceName,
      businessMonth: r.businessMonth,
      completionAmountFen: r.completionAmountFen != null ? Number(r.completionAmountFen) : null,
      feeRateSnapshotBp: r.feeRateSnapshotBp,
      grossProfitFen: r.grossProfitFen != null ? Number(r.grossProfitFen) : null,
      validationStatus: r.validationStatus,
      validationError: r.validationError,
      isVoid: r.isVoid,
      receiverPhone: sensitive ? r.receiverPhoneEnc : this.maskPhone(r.receiverPhoneEnc),
      receiverAddress: sensitive ? r.receiverAddressEnc : this.maskAddress(r.receiverAddressEnc),
    };
  }

  private maskPhone(v: string | null): string | null {
    if (!v || v.length < 7) return v;
    return `${v.slice(0, 3)}****${v.slice(-4)}`;
  }

  private maskName(v: string | null): string {
    if (!v) return '';
    return v.length === 1 ? '*' : `${v.slice(0, 1)}${'*'.repeat(Math.min(3, v.length - 1))}`;
  }

  private maskAddress(v: string | null): string | null {
    if (!v) return null;
    return v.length <= 6 ? '****' : `${v.slice(0, 3)}****${v.slice(-3)}`;
  }
}
