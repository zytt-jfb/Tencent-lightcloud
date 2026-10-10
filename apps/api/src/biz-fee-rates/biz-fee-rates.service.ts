import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, In, Repository } from 'typeorm';
import { createHash, randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import { ContractStatus } from '@biz-reporting/shared-types';
import { BizContractEntity } from '../contracts/biz-contract.entity';
import { BizContractCityAllocationEntity } from '../contracts/biz-contract-city-allocation.entity';
import { BizContractFeeRateEntity } from '../contracts/biz-contract-fee-rate.entity';
import {
  BizFeeRateImportTaskEntity, FEE_RATE_IMPORT_STATUS,
} from '../contracts/biz-fee-rate-import-task.entity';
import {
  BizFeeRateImportTaskRowEntity, FEE_RATE_IMPORT_ROW_OUTCOME,
} from '../contracts/biz-fee-rate-import-task-row.entity';
import { BizOrderRowEntity } from '../orders/biz-order-row.entity';
import { ProvinceEntity } from '../main-data/province.entity';
import { CityEntity } from '../main-data/city.entity';
import { BizOperationLogEntity } from '../operation-logs/biz-operation-log.entity';
import { RbacService, BizAuthContext } from '../rbac/rbac.service';
import { readWorkbookSafe } from '../common/files/workbook-policy';
import { BizContractsService } from '../biz-contracts/biz-contracts.service';

/** 待维护清单维护状态（页面五态） */
export const MAINTENANCE_STATUS = {
  /** 完全没有任何费率记录 */
  PENDING: 'pending',
  /** 订单月份全部有生效费率 */
  MAINTAINED: 'maintained',
  /** 部分订单月份缺少生效费率 */
  PARTIAL: 'partial',
  /** 已上传解析，等待用户确认导入 */
  IMPORT_PENDING: 'import_pending',
  /** 最近一次导入该组合存在错误行 */
  IMPORT_ERROR: 'import_error',
} as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUS)[keyof typeof MAINTENANCE_STATUS];

export const MAINTENANCE_STATUS_TEXT: Readonly<Record<string, string>> = {
  [MAINTENANCE_STATUS.PENDING]: '待填写',
  [MAINTENANCE_STATUS.MAINTAINED]: '已维护',
  [MAINTENANCE_STATUS.PARTIAL]: '部分月份缺失',
  [MAINTENANCE_STATUS.IMPORT_PENDING]: '已导入待确认',
  [MAINTENANCE_STATUS.IMPORT_ERROR]: '导入错误',
};

export interface MaintenanceFilter {
  keyword?: string;
  provinceId?: string;
  cityId?: string;
  monthFrom?: string;
  monthTo?: string;
  status?: string;
  onlyMissing?: boolean;
  page?: number;
  pageSize?: number;
}

export interface MaintenanceItem {
  contractId: string;
  contractNo: string;
  contractName: string;
  provinceId: string;
  provinceName: string;
  cityId: string;
  cityName: string;
  firstOrderMonth: string;
  lastOrderMonth: string;
  /** 最近订单月份适用的费率（整数基点）；缺失为 null，绝不伪造成 0 */
  currentRateBp: number | null;
  missingMonths: string[];
  missingMonthCount: number;
  missingMonthsText: string;
  orderCount: number;
  orderAmountFen: number;
  status: MaintenanceStatus;
  statusText: string;
  suggestedEffectiveMonth: string;
}

export interface ImportPreviewRow {
  rowNo: number;
  contractId: string | null;
  contractNo: string;
  contractName: string;
  cityId: string | null;
  cityName: string;
  effectiveMonth: string | null;
  rateBp: number | null;
  changeReason: string | null;
  outcome: string;
  message: string | null;
  prevRateBp: number | null;
}

export interface ImportPreviewResult {
  taskId: string;
  fileName: string;
  fileHash: string;
  totalRows: number;
  newCount: number;
  overwriteCount: number;
  errorCount: number;
  skipCount: number;
  affectedOrderCount: number;
  affectedAmountFen: number;
  rows: ImportPreviewRow[];
  errors: Array<{ rowNo: number; contractNo: string; cityName: string; month: string; message: string }>;
  warnings: Array<{ rowNo: number; contractNo: string; cityName: string; month: string; message: string }>;
}

export interface ConfirmResult {
  taskId: string;
  status: string;
  savedCount: number;
  recalcOrderCount: number;
  successCount: number;
  skipCount: number;
  failedCount: number;
  affectedOrderCount: number;
  affectedAmountFen: number;
  failureReasons: string[];
}

export interface CopyFeeRatesDto {
  sourceMonth: string;
  targetMonth: string;
  contractIds: string[];
  cityIds?: string[];
  overwrite?: boolean;
}

export interface BulkApplyDto {
  contractIds: string[];
  cityIds: string[];
  effectiveMonth: string;
  rateBp: number;
  changeReason?: string | null;
  overwrite?: boolean;
}

export interface BatchWriteResult {
  savedCount: number;
  newCount: number;
  overwriteCount: number;
  skipCount: number;
  failedCount: number;
  recalcOrderCount: number;
  affectedOrderCount: number;
  affectedAmountFen: number;
  failureReasons: string[];
}

const MONTH_RE = /^\d{4}-\d{2}$/;
/** 缺失月份最多展示条数（避免超长字符串拖慢列表） */
const MAX_MISSING_MONTHS_DISPLAY = 24;

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** 归一化表头：去空格、去括号内容差异、全角转半角，便于中文表头容错 */
function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .replace(/[\s\u3000]/g, '')
    .replace(/[（(]/g, '（')
    .replace(/[）)]/g, '）')
    .toLowerCase();
}

/** 解析月份单元格：支持 YYYY-MM 文本、Date、Excel 序列号 */
function parseMonthCell(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}`;
  }
  const text = String(value).trim();
  const matched = text.match(/^(\d{4})[-/年.](\d{1,2})/);
  if (matched) return `${matched[1]}-${pad2(Number(matched[2]))}`;
  if (/^\d+(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (serial > 20000 && serial < 80000) {
      try {
        const parsed = XLSX.SSF.parse_date_code(serial) as { y: number; m: number } | null;
        if (parsed?.y && parsed?.m) return `${parsed.y}-${pad2(parsed.m)}`;
      } catch { /* 解析失败按无效月份处理 */ }
    }
  }
  return null;
}

/** 解析费率单元格：百分比数值（3.5 表示 3.5%）→ 整数基点 350 */
function parseRateCell(value: unknown): number | null {
  if (value == null || value === '') return null;
  const text = String(value).trim().replace(/[％%]/g, '');
  if (!text) return null;
  const numeric = Number(text);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * 100);
}

/**
 * 管理费率批量维护服务
 * 关键规则（与现有费率模型保持一致，不新建费率模型）：
 *  - 费率维度固定为 合同 + 经营地市 + 生效月份（uk_biz_fee_rate_contract_city_month）；
 *  - 订单匹配规则不变：同一合同、同一地市、effectiveMonth <= businessMonth 的最近一条费率；
 *  - 导入必须两步：先解析预览（不写库），用户确认后才事务写入并重算订单；
 *  - 已存在记录默认不覆盖，只有明确允许覆盖时才覆盖，且记录原费率；
 *  - 缺失费率一律以 null 表达，绝不写 0 冒充已维护；
 *  - 合同、地市一律以系统内部 UUID 为准，名称仅作兜底与提示。
 */
@Injectable()
export class BizFeeRatesService {
  constructor(
    @InjectRepository(BizContractEntity)
    private readonly contractRepo: Repository<BizContractEntity>,
    @InjectRepository(BizContractCityAllocationEntity)
    private readonly allocationRepo: Repository<BizContractCityAllocationEntity>,
    @InjectRepository(BizContractFeeRateEntity)
    private readonly feeRateRepo: Repository<BizContractFeeRateEntity>,
    @InjectRepository(BizOrderRowEntity)
    private readonly orderRowRepo: Repository<BizOrderRowEntity>,
    @InjectRepository(ProvinceEntity)
    private readonly provinceRepo: Repository<ProvinceEntity>,
    @InjectRepository(CityEntity)
    private readonly cityRepo: Repository<CityEntity>,
    @InjectRepository(BizFeeRateImportTaskEntity)
    private readonly taskRepo: Repository<BizFeeRateImportTaskEntity>,
    @InjectRepository(BizFeeRateImportTaskRowEntity)
    private readonly taskRowRepo: Repository<BizFeeRateImportTaskRowEntity>,
    @InjectRepository(BizOperationLogEntity)
    private readonly opLogRepo: Repository<BizOperationLogEntity>,
    private readonly rbac: RbacService,
    private readonly dataSource: DataSource,
    private readonly contracts: BizContractsService,
  ) {}

  // ================= 基础能力 =================

  private async recordOp(
    operatorId: string,
    actionType: string,
    targetId: string,
    resultStatus = 'success',
    extra?: { targetType?: string; summaryBefore?: string; summaryAfter?: string; batchId?: string; errorMessage?: string },
  ): Promise<void> {
    await this.opLogRepo.save({
      id: randomUUID(),
      operatorUserId: operatorId,
      actionType,
      targetType: extra?.targetType ?? 'contract_fee_rate',
      targetId,
      resultStatus,
      summaryBefore: extra?.summaryBefore ?? null,
      summaryAfter: extra?.summaryAfter ?? null,
      batchId: extra?.batchId ?? null,
      errorMessage: extra?.errorMessage ?? null,
    });
  }

  /**
   * 数据范围过滤：合同管理员（scopeType='contract'）与超管放行全部；
   * 省级运营按省份过滤；地市用户仅已分配本地市。
   * 不使用 @BizScope 守卫是因为该守卫对 scopeType='contract' 直接拒绝，
   * 会把合同管理员挡在门外（需求：所有 contract_manager 都能用）。
   */
  private async loadVisibleContracts(
    auth: BizAuthContext,
    filter: { keyword?: string; provinceId?: string; cityId?: string; contractIds?: string[]; includeVoided?: boolean },
  ): Promise<BizContractEntity[]> {
    const scope = auth.dataScope;
    const effectiveProvinceId = filter.provinceId;
    if (effectiveProvinceId && scope.provinceIds.length > 0
      && !scope.provinceIds.includes(effectiveProvinceId)) {
      throw new ForbiddenException('数据范围不足');
    }
    const scopedCityIds = scope.cityIds?.length ? scope.cityIds : (scope.cityId ? [scope.cityId] : []);
    if (effectiveProvinceId && scopedCityIds.length) {
      const cities = await this.cityRepo.findBy({ id: In(scopedCityIds) });
      if (cities.length > 0 && cities.every((item) => item.provinceId !== effectiveProvinceId)) throw new ForbiddenException('数据范围不足');
    }

    const query = this.contractRepo.createQueryBuilder('c');
    query.andWhere('c.deletedAt IS NULL');
    if (!filter.includeVoided) query.andWhere('c.status <> :voided', { voided: ContractStatus.VOIDED });
    if (filter.contractIds?.length) query.andWhere('c.id IN (:...contractIds)', { contractIds: filter.contractIds });
    if (effectiveProvinceId) query.andWhere('c.provinceId = :provinceId', { provinceId: effectiveProvinceId });
    const keyword = filter.keyword?.trim();
    if (keyword) {
      query.andWhere('(c.contractNo LIKE :keyword OR c.contractName LIKE :keyword)', { keyword: `%${keyword}%` });
    }

    const filterCityId = filter.cityId ?? null;
    const queryScopeParts: string[] = [];
    const queryScopeParams: Record<string, unknown> = {};
    if (scope.allowAll || scope.scopeType === 'all') {
      // unrestricted
    } else {
      if (scope.contractIds?.length) {
        queryScopeParts.push('c.id IN (:...scopeContractIds)');
        queryScopeParams.scopeContractIds = scope.contractIds;
      }
      if (scope.provinceIds.length) {
        queryScopeParts.push('c.provinceId IN (:...scopeProvinceIds)');
        queryScopeParams.scopeProvinceIds = scope.provinceIds;
      }
    }
    if (scopedCityIds.length || filterCityId) {
      const cityIds = filterCityId ? [filterCityId] : scopedCityIds;
      query
        .innerJoin(BizContractCityAllocationEntity, 'a', 'a.contract_id = c.id AND a.city_id IN (:...filterCityIds) AND a.status = :allocActive', {
          filterCityIds: cityIds, allocActive: 'active',
        })
        .distinct(true);
      if (scopedCityIds.length) queryScopeParts.push('a.city_id IN (:...scopeCityIds)');
    }
    if (!(scope.allowAll || scope.scopeType === 'all')) {
      if (queryScopeParts.length === 0) query.andWhere('1 = 0');
      else query.andWhere(new Brackets((where) => where.where(queryScopeParts.join(' OR '), queryScopeParams)));
    }
    return query.orderBy('c.contractNo', 'ASC').getMany();
  }

  private async loadAllocationMap(contractIds: string[]): Promise<Map<string, Set<string>>> {
    const map = new Map<string, Set<string>>();
    if (contractIds.length === 0) return map;
    const allocations = await this.allocationRepo.findBy({ contractId: In(contractIds), status: 'active' });
    for (const allocation of allocations) {
      const set = map.get(allocation.contractId) ?? new Set<string>();
      set.add(allocation.cityId);
      map.set(allocation.contractId, set);
    }
    return map;
  }

  private async loadRateMap(contractIds: string[]): Promise<Map<string, Array<{ effectiveMonth: string; rateBp: number }>>> {
    const map = new Map<string, Array<{ effectiveMonth: string; rateBp: number }>>();
    if (contractIds.length === 0) return map;
    const rates = await this.feeRateRepo.find({ where: { contractId: In(contractIds) }, order: { effectiveMonth: 'ASC' } });
    for (const rate of rates) {
      const key = `${rate.contractId}|${rate.cityId}`;
      map.set(key, [...(map.get(key) ?? []), { effectiveMonth: rate.effectiveMonth, rateBp: rate.rateBp }]);
    }
    return map;
  }

  /** 订单按 合同+地市+业务月份 聚合（仅有效且未作废订单；原始字段只读不写） */
  private async loadOrderGroups(monthFrom?: string, monthTo?: string, contractIds?: string[]): Promise<Map<string, Map<string, { count: number; amountFen: number }>>> {
    const query = this.orderRowRepo.createQueryBuilder('o')
      .select('o.contractId', 'contractId')
      .addSelect('o.cityId', 'cityId')
      .addSelect('o.businessMonth', 'businessMonth')
      .addSelect('COUNT(o.id)', 'count')
      .addSelect('COALESCE(SUM(o.completionAmountFen), 0)', 'amountFen')
      .where('o.isVoid = 0').andWhere('o.isCurrent = 1')
      .andWhere('o.validationStatus = :validationStatus', { validationStatus: 'valid' })
      .andWhere('o.businessMonth IS NOT NULL')
      .andWhere('o.contractId IS NOT NULL')
      .andWhere('o.cityId IS NOT NULL');
    // 合同数量可控时下推 IN 条件，避免大表全量分组扫描
    if (contractIds && contractIds.length > 0 && contractIds.length <= 2000) {
      query.andWhere('o.contractId IN (:...contractIds)', { contractIds });
    }
    if (MONTH_RE.test(monthFrom ?? '')) query.andWhere('o.businessMonth >= :monthFrom', { monthFrom });
    if (MONTH_RE.test(monthTo ?? '')) query.andWhere('o.businessMonth <= :monthTo', { monthTo });
    query.groupBy('o.contractId').addGroupBy('o.cityId').addGroupBy('o.businessMonth');

    const raw = await query.getRawMany<{ contractId: string; cityId: string; businessMonth: string; count: string | number; amountFen: string | number }>();
    const result = new Map<string, Map<string, { count: number; amountFen: number }>>();
    for (const row of raw) {
      const key = `${row.contractId}|${row.cityId}`;
      const months = result.get(key) ?? new Map<string, { count: number; amountFen: number }>();
      months.set(row.businessMonth, {
        count: Number(row.count ?? 0),
        amountFen: Number(row.amountFen ?? 0),
      });
      result.set(key, months);
    }
    return result;
  }

  /** 最近一次导入任务对每个 合同+地市 的处置结果（用于"已导入待确认 / 导入错误"状态） */
  private async loadLatestImportOutcome(): Promise<Map<string, { outcome: string; taskStatus: string }>> {
    const map = new Map<string, { outcome: string; taskStatus: string }>();
    const raw = await this.dataSource.query(`
      SELECT r.contract_id AS contractId, r.city_id AS cityId, r.outcome AS outcome, t.status AS taskStatus
      FROM biz_fee_rate_import_task_rows r
      INNER JOIN biz_fee_rate_import_tasks t ON t.id = r.task_id
      INNER JOIN (
        SELECT contract_id, city_id, MAX(created_at) AS mx
        FROM biz_fee_rate_import_task_rows
        WHERE contract_id IS NOT NULL AND city_id IS NOT NULL
        GROUP BY contract_id, city_id
      ) m ON m.contract_id = r.contract_id AND m.city_id = r.city_id AND r.created_at = m.mx
    `) as Array<{ contractId: string; cityId: string; outcome: string; taskStatus: string }>;
    for (const row of raw ?? []) {
      map.set(`${row.contractId}|${row.cityId}`, { outcome: row.outcome, taskStatus: row.taskStatus });
    }
    return map;
  }

  private static effectiveRateOf(rates: Array<{ effectiveMonth: string; rateBp: number }>, month: string): number | null {
    let found: number | null = null;
    for (const rate of rates) {
      if (rate.effectiveMonth <= month) found = rate.rateBp;
      else break;
    }
    return found;
  }

  // ================= 1. 待维护清单 =================

  /**
   * 待维护清单：只列出"确实存在有效订单"的 合同+地市 组合，
   * 并按订单月份逐月判断是否存在生效费率，缺失月份不伪造为 0%。
   */
  async listMaintenance(auth: BizAuthContext, filter: MaintenanceFilter): Promise<{ items: MaintenanceItem[]; total: number }> {
    const contracts = await this.loadVisibleContracts(auth, {
      keyword: filter.keyword, provinceId: filter.provinceId, cityId: filter.cityId,
    });
    if (contracts.length === 0) return { items: [], total: 0 };
    const contractIds = contracts.map((contract) => contract.id);

    const [allocationMap, rateMap, orderGroups, importOutcome, provinces, cities] = await Promise.all([
      this.loadAllocationMap(contractIds),
      this.loadRateMap(contractIds),
      this.loadOrderGroups(filter.monthFrom, filter.monthTo, contractIds),
      this.loadLatestImportOutcome(),
      this.provinceRepo.find(),
      this.cityRepo.find(),
    ]);
    const provinceName = new Map(provinces.map((province) => [province.id, province.name]));
    const cityMap = new Map(cities.map((city) => [city.id, city]));

    const items: MaintenanceItem[] = [];
    for (const contract of contracts) {
      const cityIds = allocationMap.get(contract.id);
      if (!cityIds || cityIds.size === 0) continue;
      for (const cityId of cityIds) {
        if (filter.cityId && filter.cityId !== cityId) continue;
        const key = `${contract.id}|${cityId}`;
        const months = orderGroups.get(key);
        // 需求：没有订单的合同地市组合不默认列入待维护清单
        if (!months || months.size === 0) continue;
        const sortedMonths = [...months.keys()].sort();
        const firstOrderMonth = sortedMonths[0];
        const lastOrderMonth = sortedMonths[sortedMonths.length - 1];
        const rates = rateMap.get(key) ?? [];
        const missingMonths = sortedMonths.filter((month) => BizFeeRatesService.effectiveRateOf(rates, month) == null);
        const currentRateBp = BizFeeRatesService.effectiveRateOf(rates, lastOrderMonth);

        let status: MaintenanceStatus;
        if (rates.length === 0) status = MAINTENANCE_STATUS.PENDING;
        else if (missingMonths.length === 0) status = MAINTENANCE_STATUS.MAINTAINED;
        else status = MAINTENANCE_STATUS.PARTIAL;
        const latest = importOutcome.get(key);
        if (latest?.outcome === FEE_RATE_IMPORT_ROW_OUTCOME.ERROR) status = MAINTENANCE_STATUS.IMPORT_ERROR;
        else if (latest && (latest.taskStatus === FEE_RATE_IMPORT_STATUS.QUEUED || latest.taskStatus === FEE_RATE_IMPORT_STATUS.PROCESSING)) {
          status = MAINTENANCE_STATUS.IMPORT_PENDING;
        }

        const orderCount = [...months.values()].reduce((sum, value) => sum + value.count, 0);
        const orderAmountFen = [...months.values()].reduce((sum, value) => sum + value.amountFen, 0);
        const missingMonthsText = missingMonths.length === 0
          ? '无缺失'
          : `${missingMonths.slice(0, MAX_MISSING_MONTHS_DISPLAY).join('、')}${missingMonths.length > MAX_MISSING_MONTHS_DISPLAY ? ` 等 ${missingMonths.length} 个月` : ''}`;

        items.push({
          contractId: contract.id,
          contractNo: contract.contractNo,
          contractName: contract.contractName,
          provinceId: contract.provinceId,
          provinceName: provinceName.get(contract.provinceId) ?? contract.provinceId,
          cityId,
          cityName: cityMap.get(cityId)?.name ?? cityId,
          firstOrderMonth,
          lastOrderMonth,
          currentRateBp,
          missingMonths,
          missingMonthCount: missingMonths.length,
          missingMonthsText,
          orderCount,
          orderAmountFen,
          status,
          statusText: MAINTENANCE_STATUS_TEXT[status] ?? status,
          suggestedEffectiveMonth: missingMonths[0] ?? lastOrderMonth,
        });
      }
    }

    let filtered = items;
    if (filter.onlyMissing === true) filtered = filtered.filter((item) => item.missingMonthCount > 0);
    if (filter.status) filtered = filtered.filter((item) => item.status === filter.status);

    const total = filtered.length;
    const pageSize = Math.min(Math.max(filter.pageSize ?? 20, 1), 200);
    const page = Math.max(filter.page ?? 1, 1);
    const start = (page - 1) * pageSize;
    return { items: filtered.slice(start, start + pageSize), total };
  }

  /** 导出待维护清单（xlsx）；与列表同一口径，导出全部命中行（上限 20000 行保护） */
  async exportMaintenance(auth: BizAuthContext, filter: MaintenanceFilter): Promise<{ filename: string; buffer: Buffer }> {
    const { items } = await this.listMaintenance(auth, { ...filter, page: 1, pageSize: 20000 });
    const header = [
      '合同编号', '合同名称', '省份', '经营单位', '经营单位ID',
      '订单最早月份', '订单最近月份', '订单数量', '订单金额（元）',
      '当前有效费率', '建议生效月份', '管理费率（%）', '修改说明',
    ];
    const values: Array<Array<string | number>> = [header];
    for (const item of items) {
      values.push([
        item.contractNo,
        item.contractName,
        item.provinceName,
        item.cityName,
        item.cityId,
        item.firstOrderMonth,
        item.lastOrderMonth,
        item.orderCount,
        Number((item.orderAmountFen / 100).toFixed(2)),
        item.currentRateBp == null ? '缺失' : `${(item.currentRateBp / 100).toFixed(2)}%`,
        item.suggestedEffectiveMonth,
        '', // 管理费率（%）：由管理员填写
        '', // 修改说明：由管理员填写
      ]);
    }
    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet(values);
    sheet['!cols'] = [
      { wch: 22 }, { wch: 34 }, { wch: 12 }, { wch: 14 }, { wch: 38 },
      { wch: 14 }, { wch: 14 }, { wch: 10 }, { wch: 16 },
      { wch: 14 }, { wch: 14 }, { wch: 14 }, { wch: 24 },
    ];
    XLSX.utils.book_append_sheet(workbook, sheet, '管理费率待维护');
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return {
      filename: `管理费率待维护清单-${today}.xlsx`,
      buffer: Buffer.from(XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' })),
    };
  }

  // ================= 2. 导入第一步：解析预览 =================

  /**
   * 只解析不写库：完成全部校验后返回预览统计与明细，并落一条 queued 任务（审计留痕）。
   * 数据写入必须等用户调用 confirm。
   */
  async previewImport(
    auth: BizAuthContext,
    fileName: string,
    buffer: Buffer,
  ): Promise<ImportPreviewResult> {
    if (!buffer?.length) throw new BadRequestException('请选择费率 Excel 文件');
    if (buffer.length > 10 * 1024 * 1024) throw new BadRequestException('文件超过 10MB 上限');
    const workbook = readWorkbookSafe(buffer, { maxRowsPerSheet: 20_000 });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new BadRequestException('Excel 中没有可解析的工作表');
    const sheet = workbook.Sheets[sheetName];
    const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, blankrows: false }) as unknown as unknown[][];
    if (aoa.length < 2) throw new BadRequestException('Excel 中没有数据行');

    // 定位表头行
    let headerIndex = -1;
    for (let index = 0; index < Math.min(aoa.length, 10); index += 1) {
      const cells = (aoa[index] ?? []).map(normalizeHeader);
      if (cells.some((cell) => cell.includes('合同编号'))) { headerIndex = index; break; }
    }
    if (headerIndex < 0) throw new BadRequestException('未识别到表头，请先使用「导出待维护清单」生成的模板');
    const headerCells = (aoa[headerIndex] ?? []).map(normalizeHeader);
    const columnOf = (...names: string[]): number => {
      for (const name of names) {
        const index = headerCells.indexOf(normalizeHeader(name));
        if (index >= 0) return index;
      }
      return -1;
    };
    const idxContractNo = columnOf('合同编号');
    const idxContractName = columnOf('合同名称');
    const idxCityName = columnOf('经营单位', '地市');
    const idxCityId = columnOf('经营单位id', '地市id', '经营单位ID');
    const idxMonth = columnOf('建议生效月份', '生效月份');
    const idxRate = columnOf('管理费率（%）', '管理费率(%)', '管理费率');
    const idxReason = columnOf('修改说明', '变更说明');
    if (idxContractNo < 0 || idxMonth < 0 || idxRate < 0) {
      throw new BadRequestException('模板缺少必需列：合同编号 / 建议生效月份 / 管理费率（%）');
    }

    const rows: ImportPreviewRow[] = [];
    const errors: ImportPreviewResult['errors'] = [];
    const warnings: ImportPreviewResult['warnings'] = [];

    // 收集需要查询的合同编号与地市 ID，一次性查库，避免逐行查询
    const contractNos = new Set<string>();
    const cityIdInputs = new Set<string>();
    const parsedInputs: Array<{
      rowNo: number; contractNo: string; contractName: string; cityName: string; cityIdInput: string;
      month: string | null; rateBp: number | null; rateRaw: unknown; changeReason: string | null;
    }> = [];

    for (let index = headerIndex + 1; index < aoa.length; index += 1) {
      const line = aoa[index] ?? [];
      const rowNo = index + 1;
      const cell = (column: number): unknown => (column >= 0 ? line[column] : null);
      const contractNo = String(cell(idxContractNo) ?? '').trim();
      const contractName = String(cell(idxContractName) ?? '').trim();
      const cityName = String(cell(idxCityName) ?? '').trim();
      const cityIdInput = String(cell(idxCityId) ?? '').trim();
      const month = parseMonthCell(cell(idxMonth));
      const rateRaw = cell(idxRate);
      const rateBp = parseRateCell(rateRaw);
      const changeReasonRaw = cell(idxReason);
      const changeReason = changeReasonRaw == null || String(changeReasonRaw).trim() === '' ? null : String(changeReasonRaw).trim();
      if (!contractNo && !cityName && !cityIdInput && month == null && rateBp == null) continue; // 空白行
      if (contractNo) contractNos.add(contractNo);
      if (cityIdInput) cityIdInputs.add(cityIdInput);
      parsedInputs.push({ rowNo, contractNo, contractName, cityName, cityIdInput, month, rateBp, rateRaw, changeReason });
    }

    const contractList = contractNos.size > 0
      ? await this.contractRepo.find({ where: { contractNo: In([...contractNos]) } })
      : [];
    const contractByNo = new Map<string, BizContractEntity[]>();
    for (const contract of contractList) {
      contractByNo.set(contract.contractNo, [...(contractByNo.get(contract.contractNo) ?? []), contract]);
    }
    const cityList = cityIdInputs.size > 0 ? await this.cityRepo.findBy({ id: In([...cityIdInputs]) }) : [];
    const cityById = new Map(cityList.map((city) => [city.id, city]));
    const cityByName = new Map(cityList.map((city) => [`${city.provinceId}|${city.name}`, city]));
    // 名称兜底需要同城省其他地市，按涉及省份补齐
    const involvedProvinceIds = [...new Set(contractList.map((contract) => contract.provinceId))];
    const provinceCities = involvedProvinceIds.length > 0 ? await this.cityRepo.findBy({ provinceId: In(involvedProvinceIds) }) : [];
    for (const city of provinceCities) {
      cityById.set(city.id, city);
      cityByName.set(`${city.provinceId}|${city.name}`, city);
    }

    const visibleContracts = await this.loadVisibleContracts(auth, { includeVoided: false });
    const visibleContractIds = new Set(visibleContracts.map((contract) => contract.id));
    const allocationMap = await this.loadAllocationMap([...contractByNo.values()].flat().map((contract) => contract.id));
    const rateMap = await this.loadRateMap([...contractByNo.values()].flat().map((contract) => contract.id));

    const seenCombos = new Set<string>();
    const plannedByCombo = new Map<string, Array<{ effectiveMonth: string; rateBp: number }>>();

    for (const input of parsedInputs) {
      const { rowNo } = input;
      const base = {
        rowNo,
        contractId: null as string | null,
        contractNo: input.contractNo,
        contractName: input.contractName,
        cityId: null as string | null,
        cityName: input.cityName,
        effectiveMonth: input.month,
        rateBp: input.rateBp,
        changeReason: input.changeReason,
        outcome: FEE_RATE_IMPORT_ROW_OUTCOME.ERROR as string,
        message: null as string | null,
        prevRateBp: null as number | null,
      };
      const pushError = (message: string) => {
        base.message = message;
        rows.push({ ...base });
        errors.push({ rowNo, contractNo: input.contractNo, cityName: input.cityName, month: input.month ?? '', message });
      };
      const pushWarning = (message: string) => {
        warnings.push({ rowNo, contractNo: input.contractNo, cityName: input.cityName, month: input.month ?? '', message });
      };

      // ① 合同识别：合同编号全局唯一，命中多条说明数据异常
      if (!input.contractNo) { pushError('合同编号为空'); continue; }
      const matched = contractByNo.get(input.contractNo) ?? [];
      if (matched.length === 0) { pushError('合同不存在，无法识别该合同编号'); continue; }
      if (matched.length > 1) { pushError('合同编号匹配到多条合同，请核对后重新导出'); continue; }
      const contract = matched[0];
      if (contract.deletedAt) { pushError('合同已删除，不能维护费率'); continue; }
      if (contract.status === ContractStatus.VOIDED) { pushError('合同已作废，不能维护费率'); continue; }
      if (!visibleContractIds.has(contract.id)) { pushError('合同不在当前账号数据范围内'); continue; }
      base.contractId = contract.id;
      base.contractName = contract.contractName;

      // ② 经营单位：以后端 ID 为准，名称仅兜底
      const allocatedCityIds = allocationMap.get(contract.id) ?? new Set<string>();
      let cityId: string | null = null;
      if (input.cityIdInput) {
        const byId = cityById.get(input.cityIdInput);
        if (!byId || byId.provinceId !== contract.provinceId) { pushError('经营单位ID无效或不属于该合同省份'); continue; }
        cityId = byId.id;
      } else if (input.cityName) {
        const byName = cityByName.get(`${contract.provinceId}|${input.cityName}`);
        if (!byName) { pushError('经营单位名称无法匹配，请填写「经营单位ID」'); continue; }
        cityId = byName.id;
        pushWarning('未填写经营单位ID，已按名称匹配，建议后续使用导出文件中的「经营单位ID」');
      } else {
        pushError('经营单位为空，请填写「经营单位ID」'); continue;
      }
      if (!allocatedCityIds.has(cityId)) { pushError('经营单位不属于该合同的有效分配'); continue; }
      base.cityId = cityId;
      base.cityName = cityById.get(cityId)?.name ?? input.cityName;

      // ③ 生效月份
      if (!input.month) { pushError('生效月份为空或格式不是 YYYY-MM'); continue; }

      // ④ 费率
      if (input.rateBp == null) { pushError('缺少管理费率'); continue; }
      if (!Number.isFinite(input.rateBp) || input.rateBp < 0 || input.rateBp > 10000) {
        pushError('管理费率必须在 0% 到 100% 之间'); continue;
      }
      const numericRate = Number(String(input.rateRaw).replace(/[％%]/g, '').trim());
      if (Number.isFinite(numericRate) && numericRate > 0 && numericRate < 0.1) {
        pushWarning('费率数值过小，请确认填写的是百分比（3.5 表示 3.5%）');
      }

      // ⑤ 文件内重复
      const comboKey = `${contract.id}|${cityId}|${input.month}`;
      if (seenCombos.has(comboKey)) { pushError('同一合同、同一经营单位、同一生效月份在文件中重复'); continue; }
      seenCombos.add(comboKey);

      // ⑥ 与已有费率冲突
      const existing = (rateMap.get(`${contract.id}|${cityId}`) ?? []).find((rate) => rate.effectiveMonth === input.month);
      if (existing) {
        // 无条件覆盖：只要上传包含该「合同+经营单位+生效月份」费率，一律按覆盖处理。
        // 值相同也判 OVERWRITE（confirm 时同步刷新 changeReason），不再要求勾选 allowOverwrite。
        base.outcome = FEE_RATE_IMPORT_ROW_OUTCOME.OVERWRITE;
        base.prevRateBp = existing.rateBp;
        base.message = existing.rateBp === input.rateBp
          ? `上传费率与已有费率一致（${(existing.rateBp / 100).toFixed(2)}%），将按覆盖刷新变更说明`
          : `将覆盖原费率 ${(existing.rateBp / 100).toFixed(2)}%`;
      } else {
        base.outcome = FEE_RATE_IMPORT_ROW_OUTCOME.NEW;
      }

      // ⑦ 无订单提醒（不阻断，仅警告）
      const hasOrders = await this.hasOrdersFor(contract.id, cityId);
      if (!hasOrders) pushWarning('该合同与经营单位当前没有有效订单，请确认是否填写错误');

      plannedByCombo.set(`${contract.id}|${cityId}`, [...(plannedByCombo.get(`${contract.id}|${cityId}`) ?? []), { effectiveMonth: input.month, rateBp: input.rateBp }]);
      rows.push({ ...base });
    }

    // 影响订单预估：逐组合比较"写入前 / 写入后"每个月适用费率是否变化
    const affected = await this.calcAffectedOrders(plannedByCombo, rateMap);

    const newCount = rows.filter((row) => row.outcome === FEE_RATE_IMPORT_ROW_OUTCOME.NEW).length;
    const overwriteCount = rows.filter((row) => row.outcome === FEE_RATE_IMPORT_ROW_OUTCOME.OVERWRITE).length;
    const skipCount = rows.filter((row) => row.outcome === FEE_RATE_IMPORT_ROW_OUTCOME.SKIP).length;
    const errorCount = rows.filter((row) => row.outcome === FEE_RATE_IMPORT_ROW_OUTCOME.ERROR).length;

    const fileHash = createHash('sha256').update(buffer).digest('hex');
    const taskId = randomUUID();
    await this.taskRepo.save({
      id: taskId,
      operatorUserId: auth.userId,
      fileName: fileName.slice(0, 255),
      fileHash,
      status: FEE_RATE_IMPORT_STATUS.QUEUED,
      totalRows: rows.length,
      newCount,
      overwriteCount,
      errorCount,
      skipCount,
      affectedOrderCount: affected.orderCount,
      affectedAmountFen: affected.amountFen,
      recalculated: false,
      errorSummary: errors.length > 0 ? errors.slice(0, 5).map((item) => `第${item.rowNo}行：${item.message}`).join('；').slice(0, 1000) : null,
      payloadJson: JSON.stringify({ rows }),
      resultJson: null,
      confirmedAt: null,
      finishedAt: null,
    });
    if (rows.length > 0) {
      await this.taskRowRepo.save(rows.map((row) => ({
        id: randomUUID(),
        taskId,
        rowNo: row.rowNo,
        contractId: row.contractId,
        cityId: row.cityId,
        effectiveMonth: row.effectiveMonth,
        rateBp: row.rateBp,
        prevRateBp: row.prevRateBp,
        changeReason: row.changeReason,
        outcome: row.outcome,
        message: row.message,
      })));
    }

    return {
      taskId,
      fileName,
      fileHash,
      totalRows: rows.length,
      newCount,
      overwriteCount,
      errorCount,
      skipCount,
      affectedOrderCount: affected.orderCount,
      affectedAmountFen: affected.amountFen,
      rows,
      errors,
      warnings,
    };
  }

  private async hasOrdersFor(contractId: string, cityId: string): Promise<boolean> {
    const count = await this.orderRowRepo.createQueryBuilder('o')
      .where('o.contractId = :contractId', { contractId })
      .andWhere('o.cityId = :cityId', { cityId })
      .andWhere('o.isVoid = 0').andWhere('o.isCurrent = 1')
      .andWhere('o.validationStatus = :status', { status: 'valid' })
      .getCount();
    return count > 0;
  }

  /**
   * 计算"写入前后"受影响订单：仅统计有效且未作废订单，
   * 只统计其业务月份适用费率确实发生变化的行，跨行去重。
   */
  private async calcAffectedOrders(
    plannedByCombo: Map<string, Array<{ effectiveMonth: string; rateBp: number }>>,
    rateMap: Map<string, Array<{ effectiveMonth: string; rateBp: number }>>,
  ): Promise<{ orderCount: number; amountFen: number; orderIds: string[] }> {
    const combos = [...plannedByCombo.keys()];
    if (combos.length === 0) return { orderCount: 0, amountFen: 0, orderIds: [] };
    const contractIds = [...new Set(combos.map((key) => key.split('|')[0]))];
    if (contractIds.length === 0) return { orderCount: 0, amountFen: 0, orderIds: [] };

    const orders = await this.orderRowRepo.createQueryBuilder('o')
      .select(['o.id', 'o.contractId', 'o.cityId', 'o.businessMonth', 'o.completionAmountFen'])
      .where('o.contractId IN (:...contractIds)', { contractIds })
      .andWhere('o.isVoid = 0').andWhere('o.isCurrent = 1')
      .andWhere('o.validationStatus = :status', { status: 'valid' })
      .andWhere('o.businessMonth IS NOT NULL')
      .getMany();

    const orderIds: string[] = [];
    let amountFen = 0;
    for (const order of orders) {
      const key = `${order.contractId}|${order.cityId}`;
      const planned = plannedByCombo.get(key);
      if (!planned?.length) continue;
      const existing = rateMap.get(key) ?? [];
      const before = BizFeeRatesService.effectiveRateOf(existing, order.businessMonth ?? '');
      const merged = [...existing, ...planned].sort((a, b) => a.effectiveMonth.localeCompare(b.effectiveMonth));
      const after = BizFeeRatesService.effectiveRateOf(merged, order.businessMonth ?? '');
      if (before === after) continue;
      orderIds.push(order.id);
      amountFen += Number(order.completionAmountFen ?? 0);
    }
    return { orderCount: orderIds.length, amountFen, orderIds };
  }

  // ================= 3. 导入第二步：确认写入 =================

  /** 任务状态（含摘要），页面轮询用 */
  async getTask(auth: BizAuthContext, taskId: string): Promise<BizFeeRateImportTaskEntity> {
    const task = await this.taskRepo.findOneBy({ id: taskId });
    if (!task) throw new NotFoundException('导入任务不存在');
    if (task.operatorUserId !== auth.userId && auth.roleCode !== 'super_admin' && auth.roleCode !== 'admin') {
      throw new ForbiddenException('只能查看本人发起的导入任务');
    }
    return task;
  }

  async getTaskErrors(auth: BizAuthContext, taskId: string): Promise<{ items: BizFeeRateImportTaskRowEntity[] }> {
    await this.getTask(auth, taskId);
    const items = await this.taskRowRepo.find({
      where: { taskId },
      order: { rowNo: 'ASC' },
    });
    return { items: items.filter((item) => item.outcome === FEE_RATE_IMPORT_ROW_OUTCOME.ERROR || item.outcome === FEE_RATE_IMPORT_ROW_OUTCOME.SKIP) };
  }

  /** 确认导入：事务写入费率 → 重算受影响订单 → 落审计。失败整批回滚，明细可追踪。 */
  async confirmImport(auth: BizAuthContext, taskId: string): Promise<ConfirmResult> {
    const task = await this.taskRepo.findOneBy({ id: taskId });
    if (!task) throw new NotFoundException('导入任务不存在');
    if (task.operatorUserId !== auth.userId) throw new ForbiddenException('只能确认本人发起的导入任务');
    if (task.status !== FEE_RATE_IMPORT_STATUS.QUEUED) throw new BadRequestException('该任务已处理，不能重复确认');

    const taskRows = await this.taskRowRepo.find({ where: { taskId }, order: { rowNo: 'ASC' } });
    task.status = FEE_RATE_IMPORT_STATUS.PROCESSING;
    task.confirmedAt = new Date();
    await this.taskRepo.save(task);

    const writable = taskRows.filter((row) => row.outcome === FEE_RATE_IMPORT_ROW_OUTCOME.NEW || row.outcome === FEE_RATE_IMPORT_ROW_OUTCOME.OVERWRITE);
    const failureReasons: string[] = [];
    let savedCount = 0;
    let skipCount = taskRows.filter((row) => row.outcome === FEE_RATE_IMPORT_ROW_OUTCOME.SKIP).length;
    let failedCount = taskRows.filter((row) => row.outcome === FEE_RATE_IMPORT_ROW_OUTCOME.ERROR).length;
    for (const row of taskRows) {
      if (row.outcome === FEE_RATE_IMPORT_ROW_OUTCOME.ERROR && row.message) failureReasons.push(`第${row.rowNo}行：${row.message}`);
    }
    const affectedCityByContract = new Map<string, Set<string>>();
    const minMonthByContract = new Map<string, string>();
    let affectedOrderCount = 0;
    let affectedAmountFen = 0;

    try {
      await this.dataSource.transaction(async (manager) => {
        for (const row of writable) {
          if (!row.contractId || !row.cityId || !row.effectiveMonth || row.rateBp == null) {
            row.outcome = FEE_RATE_IMPORT_ROW_OUTCOME.ERROR;
            row.message = '数据不完整，无法写入';
            failedCount += 1;
            failureReasons.push(`第${row.rowNo}行：数据不完整，无法写入`);
            continue;
          }
          const contract = await manager.findOneBy(BizContractEntity, { id: row.contractId });
          if (!contract || contract.deletedAt || contract.status === ContractStatus.VOIDED) {
            row.outcome = FEE_RATE_IMPORT_ROW_OUTCOME.ERROR;
            row.message = '合同已作废或已删除';
            failedCount += 1;
            failureReasons.push(`第${row.rowNo}行：合同已作废或已删除`);
            continue;
          }
          const allocation = await manager.findOneBy(BizContractCityAllocationEntity, {
            contractId: row.contractId, cityId: row.cityId, status: 'active',
          });
          if (!allocation) {
            row.outcome = FEE_RATE_IMPORT_ROW_OUTCOME.ERROR;
            row.message = '经营单位不属于该合同的有效分配';
            failedCount += 1;
            failureReasons.push(`第${row.rowNo}行：经营单位不属于该合同的有效分配`);
            continue;
          }
          const existing = await manager.findOneBy(BizContractFeeRateEntity, {
            contractId: row.contractId, cityId: row.cityId, effectiveMonth: row.effectiveMonth,
          });
          if (existing) {
            if (row.outcome === FEE_RATE_IMPORT_ROW_OUTCOME.NEW) {
              // 预览后、确认前被他人新增：安全起见跳过，不覆盖
              row.outcome = FEE_RATE_IMPORT_ROW_OUTCOME.SKIP;
              row.message = '确认时该月份已存在费率，已跳过';
              skipCount += 1;
              continue;
            }
            row.prevRateBp = existing.rateBp;
            existing.rateBp = row.rateBp;
            existing.changeReason = row.changeReason ?? null;
            await manager.save(existing);
          } else {
            if (row.outcome === FEE_RATE_IMPORT_ROW_OUTCOME.OVERWRITE) {
              row.outcome = FEE_RATE_IMPORT_ROW_OUTCOME.NEW;
              row.prevRateBp = null;
              row.message = null;
            }
            await manager.save(manager.create(BizContractFeeRateEntity, {
              id: randomUUID(),
              contractId: row.contractId,
              cityId: row.cityId,
              effectiveMonth: row.effectiveMonth,
              rateBp: row.rateBp,
              changeReason: row.changeReason ?? null,
            }));
          }
          savedCount += 1;
          const cities = affectedCityByContract.get(row.contractId) ?? new Set<string>();
          cities.add(row.cityId);
          affectedCityByContract.set(row.contractId, cities);
          const currentMin = minMonthByContract.get(row.contractId);
          if (!currentMin || row.effectiveMonth < currentMin) minMonthByContract.set(row.contractId, row.effectiveMonth);
        }
      });
    } catch (error: unknown) {
      task.status = FEE_RATE_IMPORT_STATUS.FAILED;
      task.finishedAt = new Date();
      task.errorSummary = `写入失败已整批回滚：${(error as Error)?.message ?? '未知错误'}`.slice(0, 1000);
      task.resultJson = JSON.stringify({ savedCount: 0, failedCount, failureReasons });
      await this.taskRepo.save(task);
      await this.recordOp(auth.userId, 'contract.fee_rate.import', taskId, 'failed', { batchId: taskId, errorMessage: task.errorSummary });
      throw error;
    }

    // 订单重算：复用现有逻辑（只重算受影响的合同+地市+生效月份之后的订单）
    let recalcOrderCount = 0;
    for (const [contractId, cityIds] of affectedCityByContract) {
      const fromMonth = minMonthByContract.get(contractId);
      if (!fromMonth) continue;
      recalcOrderCount += await this.contracts.repriceOrdersForRates(contractId, [...cityIds], fromMonth);
    }

    for (const row of taskRows) await this.taskRowRepo.save(row);

    const affected = await this.calcAffectedOrders(
      this.groupPlanned(taskRows.filter((row) => row.outcome === FEE_RATE_IMPORT_ROW_OUTCOME.NEW || row.outcome === FEE_RATE_IMPORT_ROW_OUTCOME.OVERWRITE)),
      await this.loadRateMap([...affectedCityByContract.keys()]),
    );
    affectedOrderCount = affected.orderCount;
    affectedAmountFen = affected.amountFen;

    const finalStatus = failedCount > 0
      ? (savedCount > 0 ? FEE_RATE_IMPORT_STATUS.PARTIAL_FAILED : FEE_RATE_IMPORT_STATUS.FAILED)
      : FEE_RATE_IMPORT_STATUS.COMPLETED;
    task.status = finalStatus;
    task.finishedAt = new Date();
    // 最终计数一律以行明细为准（确认时可能把 new 降级为 skip）
    task.newCount = taskRows.filter((row) => row.outcome === FEE_RATE_IMPORT_ROW_OUTCOME.NEW).length;
    task.overwriteCount = taskRows.filter((row) => row.outcome === FEE_RATE_IMPORT_ROW_OUTCOME.OVERWRITE).length;
    task.skipCount = taskRows.filter((row) => row.outcome === FEE_RATE_IMPORT_ROW_OUTCOME.SKIP).length;
    task.errorCount = taskRows.filter((row) => row.outcome === FEE_RATE_IMPORT_ROW_OUTCOME.ERROR).length;
    task.affectedOrderCount = affectedOrderCount;
    task.affectedAmountFen = affectedAmountFen;
    task.recalculated = recalcOrderCount > 0;
    task.errorSummary = failureReasons.length > 0 ? failureReasons.slice(0, 5).join('；').slice(0, 1000) : null;
    task.resultJson = JSON.stringify({ savedCount, recalcOrderCount, failedCount, skipCount, failureReasons: failureReasons.slice(0, 50) });
    await this.taskRepo.save(task);

    await this.recordOp(auth.userId, 'contract.fee_rate.import', taskId, failedCount > 0 ? 'rejected' : 'success', {
      batchId: taskId,
      summaryAfter: JSON.stringify({
        fileName: task.fileName, fileHash: task.fileHash,
        newCount: task.newCount, overwriteCount: task.overwriteCount,
        skipCount: task.skipCount, failedCount,
        affectedOrderCount, recalcOrderCount,
      }),
      errorMessage: task.errorSummary ?? undefined,
    });

    return {
      taskId,
      status: finalStatus,
      savedCount,
      recalcOrderCount,
      successCount: savedCount,
      skipCount,
      failedCount,
      affectedOrderCount,
      affectedAmountFen,
      failureReasons: failureReasons.slice(0, 50),
    };
  }

  private groupPlanned(rows: BizFeeRateImportTaskRowEntity[]): Map<string, Array<{ effectiveMonth: string; rateBp: number }>> {
    const map = new Map<string, Array<{ effectiveMonth: string; rateBp: number }>>();
    for (const row of rows) {
      if (!row.contractId || !row.cityId || !row.effectiveMonth || row.rateBp == null) continue;
      const key = `${row.contractId}|${row.cityId}`;
      map.set(key, [...(map.get(key) ?? []), { effectiveMonth: row.effectiveMonth, rateBp: row.rateBp }]);
    }
    return map;
  }

  // ================= 4. 复制历史月份 / 批量套用 =================

  /** 复制历史月份：默认只补空缺，目标月份已有记录仅在 overwrite=true 时覆盖 */
  async copyFeeRates(auth: BizAuthContext, dto: CopyFeeRatesDto): Promise<BatchWriteResult> {
    if (!MONTH_RE.test(dto.sourceMonth ?? '') || !MONTH_RE.test(dto.targetMonth ?? '')) {
      throw new BadRequestException('月份格式应为 YYYY-MM');
    }
    if (dto.sourceMonth === dto.targetMonth) throw new BadRequestException('复制来源月份和目标月份不能相同');
    const contractIds = [...new Set((dto.contractIds ?? []).map((id) => String(id).trim()).filter(Boolean))];
    if (contractIds.length === 0) throw new BadRequestException('请至少选择一个合同');
    const contracts = await this.loadVisibleContracts(auth, { contractIds, includeVoided: false });
    const visibleIds = new Set(contracts.map((contract) => contract.id));
    const allocationMap = await this.loadAllocationMap(contractIds);
    const requestedCities = dto.cityIds?.length ? new Set(dto.cityIds) : null;

    const sourceRates = await this.feeRateRepo.find({
      where: { contractId: In(contractIds), effectiveMonth: dto.sourceMonth },
    });
    const existingTargets = await this.feeRateRepo.find({
      where: { contractId: In(contractIds), effectiveMonth: dto.targetMonth },
    });
    const targetByKey = new Map(existingTargets.map((rate) => [`${rate.contractId}|${rate.cityId}`, rate]));

    const planned = new Map<string, Array<{ effectiveMonth: string; rateBp: number }>>();
    const items: Array<{ row: BizFeeRateImportTaskRowEntity; create: boolean }> = [];
    const failureReasons: string[] = [];
    let skipCount = 0;
    let failedCount = 0;

    for (const source of sourceRates) {
      if (!visibleIds.has(source.contractId)) continue;
      if (requestedCities && !requestedCities.has(source.cityId)) continue;
      if (!(allocationMap.get(source.contractId) ?? new Set()).has(source.cityId)) {
        failedCount += 1;
        failureReasons.push(`${source.contractId}/${source.cityId}：经营单位不属于该合同的有效分配`);
        continue;
      }
      const key = `${source.contractId}|${source.cityId}`;
      const target = targetByKey.get(key);
      const row = this.taskRowRepo.create({
        id: randomUUID(),
        taskId: 'adhoc-copy',
        rowNo: 0,
        contractId: source.contractId,
        cityId: source.cityId,
        effectiveMonth: dto.targetMonth,
        rateBp: source.rateBp,
        prevRateBp: target?.rateBp ?? null,
        changeReason: `复制自 ${dto.sourceMonth}`,
        outcome: FEE_RATE_IMPORT_ROW_OUTCOME.NEW,
        message: null,
      });
      if (target) {
        if (target.rateBp === source.rateBp) {
          skipCount += 1;
          row.outcome = FEE_RATE_IMPORT_ROW_OUTCOME.SKIP;
          row.message = '目标月份已存在相同费率';
          continue;
        }
        if (dto.overwrite !== true) {
          skipCount += 1;
          row.outcome = FEE_RATE_IMPORT_ROW_OUTCOME.SKIP;
          row.message = `目标月份已有费率 ${(target.rateBp / 100).toFixed(2)}%，未确认覆盖已跳过`;
          continue;
        }
        row.outcome = FEE_RATE_IMPORT_ROW_OUTCOME.OVERWRITE;
      }
      items.push({ row, create: !target });
      planned.set(key, [...(planned.get(key) ?? []), { effectiveMonth: dto.targetMonth, rateBp: source.rateBp }]);
    }

    if (items.length === 0) {
      return {
        savedCount: 0, newCount: 0, overwriteCount: 0, skipCount, failedCount,
        recalcOrderCount: 0, affectedOrderCount: 0, affectedAmountFen: 0,
        failureReasons: [
          ...(sourceRates.length === 0 ? ['来源月份没有可复制的费率'] : []),
          ...(skipCount > 0 ? [`${skipCount} 个组合目标月份已有费率，未覆盖（如需覆盖请勾选允许覆盖后重试）`] : []),
          ...failureReasons,
        ].slice(0, 50),
      };
    }
    const affected = await this.calcAffectedOrders(planned, await this.loadRateMap(contractIds));
    const written = await this.writeRates(items);
    const recalcOrderCount = await this.recalcByContract(items.map((item) => item.row), dto.targetMonth);

    const result: BatchWriteResult = {
      savedCount: written,
      newCount: items.filter((item) => item.create).length,
      overwriteCount: items.filter((item) => !item.create).length,
      skipCount,
      failedCount,
      recalcOrderCount,
      affectedOrderCount: affected.orderCount,
      affectedAmountFen: affected.amountFen,
      failureReasons: failureReasons.slice(0, 50),
    };
    await this.recordOp(auth.userId, 'contract.fee_rate.copy', dto.targetMonth, failedCount > 0 ? 'rejected' : 'success', {
      summaryAfter: JSON.stringify(result),
    });
    return result;
  }

  /** 批量套用统一费率：必须由用户显式选择合同、地市、生效月份与费率，系统不自动推断 */
  async bulkApply(auth: BizAuthContext, dto: BulkApplyDto): Promise<BatchWriteResult> {
    if (!MONTH_RE.test(dto.effectiveMonth ?? '')) throw new BadRequestException('生效月份格式应为 YYYY-MM');
    if (!Number.isInteger(dto.rateBp) || dto.rateBp < 0 || dto.rateBp > 10000) {
      throw new BadRequestException('管理费率必须在 0% 到 100% 之间');
    }
    const contractIds = [...new Set((dto.contractIds ?? []).map((id) => String(id).trim()).filter(Boolean))];
    const cityIds = [...new Set((dto.cityIds ?? []).map((id) => String(id).trim()).filter(Boolean))];
    if (contractIds.length === 0) throw new BadRequestException('请至少选择一个合同');
    if (cityIds.length === 0) throw new BadRequestException('请至少选择一个经营单位');

    const contracts = await this.loadVisibleContracts(auth, { contractIds, includeVoided: false });
    const visibleIds = new Set(contracts.map((contract) => contract.id));
    const allocationMap = await this.loadAllocationMap(contractIds);
    const existing = await this.feeRateRepo.find({
      where: { contractId: In(contractIds), effectiveMonth: dto.effectiveMonth, cityId: In(cityIds) },
    });
    const existingByKey = new Map(existing.map((rate) => [`${rate.contractId}|${rate.cityId}`, rate]));

    const planned = new Map<string, Array<{ effectiveMonth: string; rateBp: number }>>();
    const items: Array<{ row: BizFeeRateImportTaskRowEntity; create: boolean }> = [];
    const failureReasons: string[] = [];
    let skipCount = 0;
    let failedCount = 0;

    for (const contractId of contractIds) {
      if (!visibleIds.has(contractId)) {
        failedCount += cityIds.length;
        failureReasons.push(`合同 ${contractId} 不在当前账号数据范围内`);
        continue;
      }
      const allocated = allocationMap.get(contractId) ?? new Set<string>();
      for (const cityId of cityIds) {
        if (!allocated.has(cityId)) {
          failedCount += 1;
          failureReasons.push(`${contractId}/${cityId}：经营单位不属于该合同的有效分配`);
          continue;
        }
        const key = `${contractId}|${cityId}`;
        const target = existingByKey.get(key);
        const row = this.taskRowRepo.create({
          id: randomUUID(),
          taskId: 'adhoc-bulk-apply',
          rowNo: 0,
          contractId,
          cityId,
          effectiveMonth: dto.effectiveMonth,
          rateBp: dto.rateBp,
          prevRateBp: target?.rateBp ?? null,
          changeReason: dto.changeReason ?? null,
          outcome: FEE_RATE_IMPORT_ROW_OUTCOME.NEW,
          message: null,
        });
        if (target) {
          if (target.rateBp === dto.rateBp) {
            skipCount += 1;
            row.outcome = FEE_RATE_IMPORT_ROW_OUTCOME.SKIP;
            row.message = '已存在相同费率';
            continue;
          }
          if (dto.overwrite !== true) {
            skipCount += 1;
            row.outcome = FEE_RATE_IMPORT_ROW_OUTCOME.SKIP;
            row.message = `该月份已有费率 ${(target.rateBp / 100).toFixed(2)}%，未确认覆盖已跳过`;
            continue;
          }
          row.outcome = FEE_RATE_IMPORT_ROW_OUTCOME.OVERWRITE;
        }
        items.push({ row, create: !target });
        planned.set(key, [...(planned.get(key) ?? []), { effectiveMonth: dto.effectiveMonth, rateBp: dto.rateBp }]);
      }
    }

    const affected = await this.calcAffectedOrders(planned, await this.loadRateMap(contractIds));
    const written = await this.writeRates(items);
    const recalcOrderCount = await this.recalcByContract(items.map((item) => item.row), dto.effectiveMonth);

    const result: BatchWriteResult = {
      savedCount: written,
      newCount: items.filter((item) => item.create).length,
      overwriteCount: items.filter((item) => !item.create).length,
      skipCount,
      failedCount,
      recalcOrderCount,
      affectedOrderCount: affected.orderCount,
      affectedAmountFen: affected.amountFen,
      failureReasons: failureReasons.slice(0, 50),
    };
    await this.recordOp(auth.userId, 'contract.fee_rate.bulk_apply', dto.effectiveMonth, failedCount > 0 ? 'rejected' : 'success', {
      summaryAfter: JSON.stringify(result),
    });
    return result;
  }

  /** 事务写入费率；返回实际写入条数 */
  private async writeRates(items: Array<{ row: BizFeeRateImportTaskRowEntity; create: boolean }>): Promise<number> {
    if (items.length === 0) return 0;
    let written = 0;
    await this.dataSource.transaction(async (manager) => {
      for (const item of items) {
        const { row } = item;
        if (!row.contractId || !row.cityId || !row.effectiveMonth || row.rateBp == null) continue;
        if (item.create) {
          await manager.save(manager.create(BizContractFeeRateEntity, {
            id: randomUUID(),
            contractId: row.contractId,
            cityId: row.cityId,
            effectiveMonth: row.effectiveMonth,
            rateBp: row.rateBp,
            changeReason: row.changeReason ?? null,
          }));
        } else {
          const existing = await manager.findOneBy(BizContractFeeRateEntity, {
            contractId: row.contractId ?? '', cityId: row.cityId ?? '', effectiveMonth: row.effectiveMonth ?? '',
          });
          if (!existing) {
            await manager.save(manager.create(BizContractFeeRateEntity, {
              id: randomUUID(),
              contractId: row.contractId,
              cityId: row.cityId,
              effectiveMonth: row.effectiveMonth,
              rateBp: row.rateBp,
              changeReason: row.changeReason ?? null,
            }));
          } else {
            row.prevRateBp = existing.rateBp;
            existing.rateBp = row.rateBp ?? 0;
            existing.changeReason = row.changeReason ?? null;
            await manager.save(existing);
          }
        }
        written += 1;
      }
    });
    return written;
  }

  /** 按合同聚合后复用现有重算逻辑（只重算受影响地市、生效月份之后的有效订单） */
  private async recalcByContract(rows: BizFeeRateImportTaskRowEntity[], fromMonth: string): Promise<number> {
    const byContract = new Map<string, Set<string>>();
    for (const row of rows) {
      if (!row.contractId || !row.cityId) continue;
      const cities = byContract.get(row.contractId) ?? new Set<string>();
      cities.add(row.cityId);
      byContract.set(row.contractId, cities);
    }
    let total = 0;
    for (const [contractId, cityIds] of byContract) {
      total += await this.contracts.repriceOrdersForRates(contractId, [...cityIds], fromMonth);
    }
    return total;
  }
}
