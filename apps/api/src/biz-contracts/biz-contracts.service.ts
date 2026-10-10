import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, DataSource, Repository, Not, In, IsNull } from 'typeorm';
import { createHash, randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import { ContractStatus, ContractTag, VoidSummaryChoice, PlatformRole, computeEffectiveContractStatus } from '@biz-reporting/shared-types';
import { BizContractEntity } from '../contracts/biz-contract.entity';
import { BizContractCityAllocationEntity } from '../contracts/biz-contract-city-allocation.entity';
import { BizContractFeeRateEntity } from '../contracts/biz-contract-fee-rate.entity';
import { BizContractAlertEntity } from '../contracts/biz-contract-alert.entity';
import { BizOrderRowEntity } from '../orders/biz-order-row.entity';
import { BizOfflineCompletionEntity } from '../completions/biz-offline-completion.entity';
import { ProvinceEntity } from '../main-data/province.entity';
import { CityEntity } from '../main-data/city.entity';
import { BizOperationLogEntity } from '../operation-logs/biz-operation-log.entity';
import { BizCostEntryEntity } from '../costs/biz-cost-entry.entity';
import { BizSystemSettingEntity } from '../aggregates/biz-system-setting.entity';
import { CityAliasEntity } from '../main-data/city-alias.entity';
import { BizContractImportRecordEntity } from '../contracts/biz-contract-import-record.entity';
import { BizContractImportSheetEntity } from '../contracts/biz-contract-import-sheet.entity';
import { BizContractSourceRowEntity } from '../contracts/biz-contract-source-row.entity';
import { RbacService, BizAuthContext } from '../rbac/rbac.service';
import { readWorkbookSafe, WORKBOOK_LIMITS } from '../common/files/workbook-policy';
import { BizAggregateService } from '../biz-aggregates/biz-aggregate.service';

const LEDGER_PROVINCES: ReadonlyArray<{ code: string; name: string; aliases: string[] }> = [
  { code: '110000', name: '北京市', aliases: ['北京'] }, { code: '120000', name: '天津市', aliases: ['天津'] },
  { code: '130000', name: '河北省', aliases: ['河北'] }, { code: '140000', name: '山西省', aliases: ['山西'] },
  { code: '150000', name: '内蒙古自治区', aliases: ['内蒙古', '内蒙古自治区'] }, { code: '210000', name: '辽宁省', aliases: ['辽宁'] },
  { code: '220000', name: '吉林省', aliases: ['吉林'] }, { code: '230000', name: '黑龙江省', aliases: ['黑龙江'] },
  { code: '310000', name: '上海市', aliases: ['上海'] }, { code: '320000', name: '江苏省', aliases: ['江苏'] },
  { code: '330000', name: '浙江省', aliases: ['浙江'] }, { code: '340000', name: '安徽省', aliases: ['安徽'] },
  { code: '350000', name: '福建省', aliases: ['福建'] }, { code: '360000', name: '江西省', aliases: ['江西'] },
  { code: '370000', name: '山东省', aliases: ['山东'] }, { code: '410000', name: '河南省', aliases: ['河南'] },
  { code: '420000', name: '湖北省', aliases: ['湖北'] }, { code: '430000', name: '湖南省', aliases: ['湖南'] },
  { code: '440000', name: '广东省', aliases: ['广东'] }, { code: '450000', name: '广西壮族自治区', aliases: ['广西', '广西壮族自治区'] },
  { code: '460000', name: '海南省', aliases: ['海南'] }, { code: '500000', name: '重庆市', aliases: ['重庆'] },
  { code: '510000', name: '四川省', aliases: ['四川'] }, { code: '520000', name: '贵州省', aliases: ['贵州'] },
  { code: '530000', name: '云南省', aliases: ['云南'] }, { code: '540000', name: '西藏自治区', aliases: ['西藏', '西藏自治区'] },
  { code: '610000', name: '陕西省', aliases: ['陕西'] }, { code: '620000', name: '甘肃省', aliases: ['甘肃'] },
  { code: '630000', name: '青海省', aliases: ['青海'] }, { code: '640000', name: '宁夏回族自治区', aliases: ['宁夏', '宁夏回族自治区'] },
  { code: '650000', name: '新疆维吾尔自治区', aliases: ['新疆', '新疆维吾尔自治区'] },
];

export interface CreateContractDto {
  contractNo: string;
  contractName: string;
  taxInclusiveAmountFen: number;
  taxExclusiveAmountFen?: number | null;
  provinceId: string;
  startDate?: string | null;
  endDate?: string | null;
  parentContractId?: string | null;
}

export interface UpdateContractDto {
  contractName?: string;
  taxInclusiveAmountFen?: number;
  taxExclusiveAmountFen?: number | null;
  startDate?: string | null;
  endDate?: string | null;
}

export interface AllocationDto {
  cityId: string;
  quotaFen: number;
}

export interface FeeRateDto {
  cityId: string;
  effectiveMonth: string; // YYYY-MM
  rateBp: number; // 整数基点
  changeReason?: string | null;
}

export interface BulkFeeRateDto {
  cityIds: string[];
  effectiveMonth: string;
  rateBp: number;
  changeReason?: string | null;
  overwrite?: boolean;
}

export interface CopyFeeRateDto {
  sourceMonth: string;
  targetMonth: string;
  cityIds?: string[];
  overwrite?: boolean;
}

export interface MaintainImportRowDto {
  contractNo: string;
  contractName: string;
  provinceId: string;
  cityIds: string[];
  taxInclusiveAmountFen: number;
  taxExclusiveAmountFen?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  signedDate?: string | null;
  reason?: string | null;
}

export interface VoidContractDto {
  summaryChoice: VoidSummaryChoice;
  reason: string;
}

/**
 * 合同域服务（新基线）
 * 基线：01 §4 / 03 / 04 §2-3 / 07 TABLE 4
 * 关键规则：
 *  - 合同号全局唯一；系统内部 UUID；金额整数分；
 *  - 草稿允许不完整；生效前补齐（编号/名称/含税金额>0/起止日期/已分配地市均有费率）；
 *  - 生效后合同额永久锁定（amountLocked），录错只能作废重建；
 *  - 状态机：draft → active → completed / voided；恢复仅 super_admin；
 *  - 地市分配：额度合计 ≤ 合同额；取消仅 super_admin；历史数据保留；
 *  - 费率：合同+地市+生效月份历史；按业务月份取快照；
 *  - 进度 = 有效完工（订单+已审核线下完工）÷ 合同额，允许 >100%；超额动态计算。
 */
@Injectable()
export class BizContractsService {
  constructor(
    @InjectRepository(BizContractEntity)
    private readonly contractRepo: Repository<BizContractEntity>,
    @InjectRepository(BizContractCityAllocationEntity)
    private readonly allocationRepo: Repository<BizContractCityAllocationEntity>,
    @InjectRepository(BizContractFeeRateEntity)
    private readonly feeRateRepo: Repository<BizContractFeeRateEntity>,
    @InjectRepository(BizContractAlertEntity)
    private readonly alertRepo: Repository<BizContractAlertEntity>,
    @InjectRepository(BizOrderRowEntity)
    private readonly orderRowRepo: Repository<BizOrderRowEntity>,
    @InjectRepository(BizOfflineCompletionEntity)
    private readonly offlineRepo: Repository<BizOfflineCompletionEntity>,
    @InjectRepository(ProvinceEntity)
    private readonly provinceRepo: Repository<ProvinceEntity>,
    @InjectRepository(CityEntity)
    private readonly cityRepo: Repository<CityEntity>,
    @InjectRepository(CityAliasEntity)
    private readonly cityAliasRepo: Repository<CityAliasEntity>,
    @InjectRepository(BizContractImportRecordEntity)
    private readonly importRecordRepo: Repository<BizContractImportRecordEntity>,
    @InjectRepository(BizContractImportSheetEntity)
    private readonly importSheetRepo: Repository<BizContractImportSheetEntity>,
    @InjectRepository(BizContractSourceRowEntity)
    private readonly sourceRowRepo: Repository<BizContractSourceRowEntity>,
    @InjectRepository(BizOperationLogEntity)
    private readonly opLogRepo: Repository<BizOperationLogEntity>,
    @InjectRepository(BizCostEntryEntity)
    private readonly costRepo: Repository<BizCostEntryEntity>,
    @InjectRepository(BizSystemSettingEntity)
    private readonly settingRepo: Repository<BizSystemSettingEntity>,
    private readonly rbac: RbacService,
    private readonly dataSource: DataSource,
    private readonly aggregates: BizAggregateService,
  ) {}

  // ================= 基础 =================

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
      targetType: extra?.targetType ?? 'contract',
      targetId,
      resultStatus,
      summaryBefore: extra?.summaryBefore ?? null,
      summaryAfter: extra?.summaryAfter ?? null,
      batchId: extra?.batchId ?? null,
      errorMessage: extra?.errorMessage ?? null,
    });
  }

  private async getContractOrFail(id: string): Promise<BizContractEntity> {
    const contract = await this.contractRepo.findOneBy({ id });
    if (!contract) throw new NotFoundException('合同不存在');
    return contract;
  }

  /** 合同可见性统一按范围授权；合同范围只允许显式授权的合同。 */
  private async assertContractVisible(auth: BizAuthContext, contract: BizContractEntity): Promise<void> {
    const scope = auth.dataScope;
    if (auth.isSuperAdmin || scope.allowAll || scope.scopeType === 'all') return;
    if (scope.contractIds?.includes(contract.id)) return;
    if (scope.deniedContractIds?.includes(contract.id)) throw new ForbiddenException('数据范围不足');
    if (scope.provinceIds.length > 0 && scope.provinceIds.includes(contract.provinceId) && !scope.deniedProvinceIds?.includes(contract.provinceId)) return;
    const cityIds = scope.cityIds?.length ? scope.cityIds : (scope.cityId ? [scope.cityId] : []);
    if (cityIds.length > 0) {
      const count = await this.allocationRepo.count({ where: { contractId: contract.id, cityId: In(cityIds), status: 'active' } });
      if (count > 0) return;
    }
    throw new ForbiddenException('数据范围不足');
  }

  // ================= 列表与详情 =================

  /** 合同列表（按数据范围过滤；city_user 仅已分配本地市；默认排除软删除，includeDeleted=true 时展示已删除可恢复） */
  async list(auth: BizAuthContext, filter: { provinceId?: string; cityId?: string; status?: string; keyword?: string; includeDeleted?: boolean }): Promise<BizContractEntity[]> {
    await this.rbac.assertProvinceScope(auth, filter.provinceId);
    if (filter.cityId) await this.rbac.assertCityScope(auth, filter.cityId);

    const query = this.contractRepo.createQueryBuilder('c');
    // 软删除：默认仅看未删除；"已删除"视图显式包含
    if (!filter.includeDeleted) query.andWhere('c.deletedAt IS NULL');
    if (filter.status) query.andWhere('c.status = :status', { status: filter.status });
    if (filter.provinceId) query.andWhere('c.provinceId = :provinceId', { provinceId: filter.provinceId });
    const keyword = filter.keyword?.trim();
    if (keyword) {
      query.andWhere('(c.contractNo LIKE :keyword OR c.contractName LIKE :keyword)', { keyword: `%${keyword}%` });
    }

    const scope = auth.dataScope;
    const scopeParts: string[] = [];
    const scopeParams: Record<string, unknown> = {};
    if (!(scope.allowAll || scope.scopeType === 'all')) {
      if (scope.contractIds?.length) { scopeParts.push('c.id IN (:...scopeContractIds)'); scopeParams.scopeContractIds = scope.contractIds; }
      if (scope.provinceIds.length) { scopeParts.push('c.provinceId IN (:...scopeProvinceIds)'); scopeParams.scopeProvinceIds = scope.provinceIds; }
    }
    if (scope.cityIds?.length || scope.cityId) {
      const scopedCityIds = scope.cityIds?.length ? scope.cityIds : [scope.cityId!];
      query
        .innerJoin(BizContractCityAllocationEntity, 'a', 'a.contract_id = c.id AND a.city_id IN (:...scopeCityIds) AND a.status = :allocActive', {
          scopeCityIds: scopedCityIds, allocActive: 'active',
        })
        .distinct(true);
      scopeParts.push('a.city_id IN (:...scopeCityIds)');
    }
    if (!(scope.allowAll || scope.scopeType === 'all')) {
      if (scopeParts.length === 0) {
        query.andWhere('1 = 0');
      } else {
        query.andWhere(new Brackets((where) => where.where(scopeParts.join(' OR '), { ...scopeParams, scopeCityIds: scope.cityIds?.length ? scope.cityIds : [scope.cityId] })));
      }
    }
    // contract_manager（scopeType='contract'）与 super_admin（all）不加过滤
    const contracts = await query.orderBy('c.createdAt', 'DESC').getMany();
    const provinces = await this.provinceRepo.find();
    const provinceNames = new Map(provinces.map((province) => [province.id, province.name]));
    return contracts.map((contract) => ({ ...contract, provinceName: provinceNames.get(contract.provinceId) ?? contract.provinceId }));
  }

  async overview(auth: BizAuthContext, filter: { provinceId?: string; cityId?: string; keyword?: string; startDate?: string; endDate?: string; status?: string }): Promise<BizContractEntity[]> {
    const statuses = filter.status ? [filter.status] : [ContractStatus.ACTIVE, ContractStatus.COMPLETED];
    const lists = await Promise.all(statuses.map((status) => this.list(auth, { provinceId: filter.provinceId, cityId: filter.cityId, keyword: filter.keyword, status })));
    const startDate = filter.startDate?.trim();
    const endDate = filter.endDate?.trim();
    return [...new Map(lists.flat().filter((contract) => contract.sourceImportRecordId != null && (!startDate || (contract.startDate ?? '') >= startDate) && (!endDate || (contract.endDate ?? '') <= endDate)).map((contract) => [contract.id, contract])).values()];
  }

  /**
   * 批量完工进度（合同概览"完工进度"列用）：按合同级口径
   *   progressPct = (有效订单完工 + 已审核线下完工) / 含税合同金额 × 100
   * 有效订单 = isVoid=false 且 validationStatus=valid；线下 = status=approved。
   * 数据范围：沿用与列表一致的可见性（city 仅已分配本地市；province 仅范围内省份）。
   * 金额<=0 或缺失 → 返回 null（前端显示 '-'）；不截断 >100%。
   */
  async batchProgress(auth: BizAuthContext, contractIds: string[]): Promise<Record<string, number | null>> {
    const ids = [...new Set((contractIds ?? []).filter(Boolean))];
    if (!ids.length) return {};
    const contracts = await this.contractRepo.find({ where: { id: In(ids), deletedAt: IsNull() } });
    if (!contracts.length) return {};

    const scope = auth.dataScope;
    let visibleIds: string[];
    if (scope.scopeType === 'city') {
      const allocs = await this.allocationRepo.find({
        where: { contractId: In(contracts.map((c) => c.id)), cityId: scope.cityIds?.length ? In(scope.cityIds) : (scope.cityId ?? 'no_match'), status: 'active' },
      });
      const okSet = new Set(allocs.map((a) => a.contractId));
      visibleIds = contracts.filter((c) => okSet.has(c.id)).map((c) => c.id);
    } else if (scope.scopeType === 'province' && scope.provinceIds.length > 0) {
      visibleIds = contracts.filter((c) => scope.provinceIds.includes(c.provinceId)).map((c) => c.id);
    } else {
      visibleIds = contracts.map((c) => c.id);
    }
    if (!visibleIds.length) return {};

    const orders = await this.orderRowRepo.find({ where: { contractId: In(visibleIds), isVoid: false, isCurrent: true, validationStatus: 'valid' } });
    const offlines = await this.offlineRepo.find({ where: { contractId: In(visibleIds), status: 'approved' } });
    const orderSum = new Map<string, number>();
    for (const o of orders) orderSum.set(String(o.contractId), (orderSum.get(String(o.contractId)) ?? 0) + (Number(o.completionAmountFen) || 0));
    const offlineSum = new Map<string, number>();
    for (const o of offlines) offlineSum.set(String(o.contractId), (offlineSum.get(String(o.contractId)) ?? 0) + (Number(o.amountFen) || 0));

    const result: Record<string, number | null> = {};
    for (const c of contracts) {
      if (!visibleIds.includes(c.id)) continue;
      const amount = Number(c.taxInclusiveAmountFen) || 0;
      const completion = (orderSum.get(c.id) ?? 0) + (offlineSum.get(c.id) ?? 0);
      result[c.id] = amount > 0 ? (completion / amount) * 100 : null;
    }
    return result;
  }

  async listPendingImportRows(auth: BizAuthContext, keyword?: string): Promise<Array<Record<string, unknown>>> {
    const scope = auth.dataScope;
    const rows = await this.sourceRowRepo.find({ where: { normalizationStatus: 'needs_review' }, order: { createdAt: 'DESC', sourceRowNo: 'ASC' }, take: 500 });
    const visibleRows = rows.filter((row) => {
      if (auth.isSuperAdmin || scope.scopeType === 'all' || scope.scopeType === 'contract') return true;
      if (scope.scopeType === 'province') return !scope.provinceIds.length || (row.provinceId != null && scope.provinceIds.includes(row.provinceId));
      return scope.scopeType === 'city' && (row.cityId != null && (scope.cityIds?.includes(row.cityId) ?? false));
    });
    const sheetIds = [...new Set(visibleRows.map((row) => row.sheetId))];
    const sheets = sheetIds.length ? await this.importSheetRepo.findBy({ id: In(sheetIds) }) : [];
    const sheetById = new Map(sheets.map((sheet) => [sheet.id, sheet]));
    const normalizedKeyword = keyword?.trim().toLowerCase();
    return visibleRows.map((row) => {
      const sheet = sheetById.get(row.sheetId);
      const cells = this.decodeSourceCells(row.cellsJson);
      const read = (names: string[]) => this.cellByHeader(sheet?.headersJson ?? [], cells, names);
      return {
        id: `pending:${row.id}`, sourceRowId: row.id, sourceRowNo: row.sourceRowNo, importRecordId: row.importRecordId,
        sheetName: sheet?.sheetName ?? '-', contractNo: this.normalizePrimaryContractNo(read(['甲方合同编号', '合同编号'])), contractName: read(['合同名称']),
        provinceId: row.provinceId, provinceName: read(['省份']), cityName: read(['地市']),
        taxInclusiveAmountRaw: read(['合同金额（含税，万元）']), signedDateRaw: read(['签订日期']), endDateRaw: read(['合同到期时间']),
        validationError: row.normalizationMessage ?? '需要补充合同信息', status: 'needs_review', isPendingImport: true,
      };
    }).filter((row) => !normalizedKeyword || [row.contractNo, row.contractName, row.provinceName, row.cityName, row.validationError].some((value) => String(value ?? '').toLowerCase().includes(normalizedKeyword)));
  }

  async maintainImportRow(auth: BizAuthContext, sourceRowId: string, dto: MaintainImportRowDto): Promise<BizContractEntity> {
    const sourceRow = await this.sourceRowRepo.findOneBy({ id: sourceRowId });
    if (!sourceRow || sourceRow.normalizationStatus !== 'needs_review') throw new NotFoundException('待维护合同原始行不存在');
    const scope = auth.dataScope;
    if (!auth.isSuperAdmin && scope.scopeType !== 'all' && scope.scopeType !== 'contract') {
      if (scope.scopeType === 'province' && sourceRow.provinceId != null && scope.provinceIds.includes(sourceRow.provinceId)) {
        // province-scoped maintain is permitted for rows already mapped to this province.
      } else if (scope.scopeType !== 'city' || !(sourceRow.cityId != null && (scope.cityIds?.includes(sourceRow.cityId) ?? false))) throw new ForbiddenException('数据范围不足');
    }
    const contractNo = this.normalizePrimaryContractNo(dto.contractNo);
    const contractName = dto.contractName.trim();
    const cityIds = [...new Set(dto.cityIds.map((cityId) => cityId.trim()).filter(Boolean))].sort();
    if (!contractNo || !contractName || !dto.provinceId || !Number.isFinite(dto.taxInclusiveAmountFen) || dto.taxInclusiveAmountFen <= 0) {
      throw new BadRequestException('合同编号、合同名称、省份和正数含税合同金额为必填项');
    }
    if (await this.contractRepo.findOneBy({ contractNo })) throw new BadRequestException('合同编号已存在');
    const province = await this.provinceRepo.findOneBy({ id: dto.provinceId });
    if (!province) throw new BadRequestException('省份不存在');
    const cities = cityIds.length ? await this.cityRepo.findBy({ id: In(cityIds), status: 'active' }) : [];
    if (cities.length !== cityIds.length || cities.some((city) => city.provinceId !== dto.provinceId)) throw new BadRequestException('经营单位不存在或不属于所选省份');
    const importSheet = await this.importSheetRepo.findOneBy({ id: sourceRow.sheetId });
    const cells = this.decodeSourceCells(sourceRow.cellsJson);
    const read = (names: string[]) => this.cellByHeader(importSheet?.headersJson ?? [], cells, names);
    const contractId = randomUUID();
    const amountFen = Math.round(dto.taxInclusiveAmountFen);
    await this.dataSource.transaction(async (manager) => {
      await manager.insert(BizContractEntity, {
        id: contractId, contractNo, contractName, taxInclusiveAmountFen: amountFen,
        taxExclusiveAmountFen: dto.taxExclusiveAmountFen != null ? Math.round(dto.taxExclusiveAmountFen) : null,
        archiveContractNo: read(['档案室合同编号']) || null, projectIdentityCode: read(['项目唯一识别编码']) || null,
        contractCategory1: read(['合同分类-1']) || null, contractCategory2: read(['合同分类-2']) || null,
        winningProjectName: read(['中标项目名称']) || null, signedDate: dto.signedDate ?? this.parseLedgerDate(read(['签订日期'])),
        taxRateRaw: read(['税率']) || null, taxRateBp: null, taxRateBpsJson: this.parseTaxRateBps(read(['税率'])),
        sourceImportRecordId: sourceRow.importRecordId, sourceSheetId: sourceRow.sheetId, sourceRowId: sourceRow.id, sourceRowNo: sourceRow.sourceRowNo,
        provinceId: dto.provinceId, startDate: dto.startDate ?? null, endDate: dto.endDate ?? null,
        status: ContractStatus.ACTIVE, tags: [], amountLocked: true, parentContractId: null, versionNo: 1, createdBy: auth.userId, updatedBy: auth.userId,
      });
      for (const [cityId, quotaFen] of this.averageAllocationFens(amountFen, cityIds)) {
        await manager.insert(BizContractCityAllocationEntity, { id: randomUUID(), contractId, cityId, quotaFen, status: 'active', versionNo: 1 });
      }
      await manager.update(BizContractSourceRowEntity, { id: sourceRow.id }, { normalizationStatus: 'valid', normalizationMessage: dto.reason?.trim() || null, provinceId: dto.provinceId, cityId: cityIds.length === 1 ? cityIds[0] : null, contractId });
      await manager.insert(BizOperationLogEntity, { id: randomUUID(), operatorUserId: auth.userId, actionType: 'contract.import_row.maintain', targetType: 'contract', targetId: contractId, resultStatus: 'success', batchId: sourceRow.importRecordId, summaryAfter: dto.reason?.trim() || '待维护台账行已创建执行中合同' });
    });
    return this.getContractOrFail(contractId);
  }

  /** 详情聚合（基础/分配/费率/进度/预警/来源汇总） */
  async detail(auth: BizAuthContext, id: string) {
    const contract = await this.getContractOrFail(id);
    await this.assertContractVisible(auth, contract);

    // 数据范围裁剪：地市用户只看自己地市的分配/费率/完工；省范围看省下辖市；all/contract 全量
    let visibleCityIds: Set<string> | null = null;
    if (auth.dataScope.scopeType === 'city') {
      visibleCityIds = auth.dataScope.cityIds?.length ? new Set(auth.dataScope.cityIds) : new Set();
    } else if (auth.dataScope.scopeType === 'province' && auth.dataScope.provinceIds.length > 0) {
      const provinceCities = await this.cityRepo.createQueryBuilder('ct')
        .select('ct.id', 'id')
        .where('ct.provinceId IN (:...provinceIds)', { provinceIds: auth.dataScope.provinceIds })
        .getRawMany();
      visibleCityIds = new Set(provinceCities.map((c) => c.id));
    }
    const inScope = (cityId: string | null | undefined) => !visibleCityIds || (cityId != null && visibleCityIds.has(cityId));

    const allocations = (await this.allocationRepo.findBy({ contractId: id })).filter((a) => inScope(a.cityId));
    const feeRates = (await this.feeRateRepo.findBy({ contractId: id })).filter((f) => inScope(f.cityId));
    const alerts = (await this.alertRepo.findBy({ contractId: id, currentStatus: 'active' }))
      .filter((alert) => alert.alertType !== ContractTag.EXPIRED);

    // 有效完工（订单未作废 + 线下完工已审核未作废；按可见地市过滤）
    const orders = (await this.orderRowRepo.findBy({ contractId: id, isVoid: false, isCurrent: true, validationStatus: 'valid' })).filter((o) => inScope(o.cityId));
    const offlines = (await this.offlineRepo.findBy({ contractId: id, status: 'approved' })).filter((o) => inScope(o.cityId));
    const orderCompletionFen = orders.reduce((s, o) => s + (Number(o.completionAmountFen) || 0), 0);
    const offlineCompletionFen = offlines.reduce((s, o) => s + Number(o.amountFen), 0);
    const totalCompletionFen = orderCompletionFen + offlineCompletionFen;
    const contractAmountFen = Number(contract.taxInclusiveAmountFen) || 0;
    // 进度口径：all/contract 用合同额（合同整体进度）；city/province 范围用可见地市【active】分配额度合计（本地市进度，明确标注 progressBasis；已取消分配不稀释分母）
    const visibleQuotaFen = allocations.filter((a) => a.status === 'active').reduce((sum, a) => sum + (Number(a.quotaFen) || 0), 0);
    const progressBasis = visibleCityIds ? (auth.dataScope.scopeType === 'city' ? 'city-quota' : 'province-quota') : 'contract';
    const progressDenominator = visibleCityIds ? visibleQuotaFen : contractAmountFen;
    const progress = progressDenominator > 0 ? (totalCompletionFen / progressDenominator) * 100 : 0;
    const overrunFen = Math.max(totalCompletionFen - progressDenominator, 0);

    const cityRows = await Promise.all(allocations.map(async (alloc) => {
      const city = await this.cityRepo.findOneBy({ id: alloc.cityId });
      const cityOrders = orders.filter((o) => o.cityId === alloc.cityId);
      const cityOfflines = offlines.filter((o) => o.cityId === alloc.cityId);
      const cityCompletionFen =
        cityOrders.reduce((s, o) => s + (Number(o.completionAmountFen) || 0), 0) +
        cityOfflines.reduce((s, o) => s + Number(o.amountFen), 0);
      const cityQuota = Number(alloc.quotaFen) || 0;
      return {
        cityId: alloc.cityId,
        cityName: city?.name ?? alloc.cityId,
        quotaFen: cityQuota,
        status: alloc.status,
        effectiveAt: alloc.effectiveAt,
        completionFen: cityCompletionFen,
        progress: cityQuota > 0 ? (cityCompletionFen / cityQuota) * 100 : 0,
        overrunFen: Math.max(cityCompletionFen - cityQuota, 0),
        orderCompletionFen: cityOrders.reduce((s, o) => s + (Number(o.completionAmountFen) || 0), 0),
        offlineCompletionFen: cityOfflines.reduce((s, o) => s + Number(o.amountFen), 0),
      };
    }));

    let activationIssues: string[] = [];
    if (contract.status === ContractStatus.DRAFT) {
      try {
        activationIssues = await this.completenessIssues(contract);
      } catch (error) {
        activationIssues = [error instanceof BadRequestException ? String(error.message) : '合同资料完整性校验失败'];
      }
    }

    // 有效展示状态：实时合同详情以服务端当日判断到期（主状态字段不改写）
    const detailAsOf = new Date().toISOString().slice(0, 10);

    return {
      contract: {
        id: contract.id,
        contractNo: contract.contractNo,
        contractName: contract.contractName,
        taxInclusiveAmountFen: Number(contract.taxInclusiveAmountFen),
        taxExclusiveAmountFen: contract.taxExclusiveAmountFen != null ? Number(contract.taxExclusiveAmountFen) : null,
        provinceId: contract.provinceId,
        startDate: contract.startDate,
        endDate: contract.endDate,
        status: contract.status,
        effectiveStatus: computeEffectiveContractStatus(contract.status, contract.endDate, detailAsOf),
        statusAsOf: detailAsOf,
        tags: contract.tags ?? [],
        amountLocked: contract.amountLocked,
        voidSummaryChoice: contract.voidSummaryChoice,
        parentContractId: contract.parentContractId,
        versionNo: contract.versionNo,
        createdAt: contract.createdAt,
        archiveContractNo: contract.archiveContractNo,
        projectIdentityCode: contract.projectIdentityCode,
        contractCategory1: contract.contractCategory1,
        contractCategory2: contract.contractCategory2,
        winningProjectName: contract.winningProjectName,
        signedDate: contract.signedDate,
        taxRateRaw: contract.taxRateRaw,
        taxRateBp: contract.taxRateBp,
        sourceImportRecordId: contract.sourceImportRecordId,
        sourceSheetId: contract.sourceSheetId,
        sourceRowNo: contract.sourceRowNo,
      },
      allocations: cityRows,
      feeRates: feeRates.map((f) => ({ cityId: f.cityId, effectiveMonth: f.effectiveMonth, rateBp: f.rateBp, changeReason: f.changeReason })),
      activationIssues,
      alerts: alerts.map((a) => ({ alertType: a.alertType, firstTriggeredAt: a.firstTriggeredAt })),
      progress: {
        orderCompletionFen,
        offlineCompletionFen,
        totalCompletionFen,
        contractAmountFen,
        progress,
        progressBasis,
        quotaFen: visibleCityIds ? visibleQuotaFen : null,
        remainingFen: progressDenominator - totalCompletionFen,
        overrunFen,
      },
      // M6：成本/净利（按合同分配地市汇总已审核成本）
      finance: await this.financeForContract(contract, visibleCityIds),
    };
  }

  // ================= 创建/编辑 =================

  async create(auth: BizAuthContext, dto: CreateContractDto): Promise<BizContractEntity> {
    const contractNo = this.normalizePrimaryContractNo(dto.contractNo);
    if (!contractNo) throw new BadRequestException('合同编号不能为空');
    const existing = await this.contractRepo.findOneBy({ contractNo });
    if (existing) throw new BadRequestException('合同编号已存在'); // CON-001 服务端唯一
    const province = await this.provinceRepo.findOneBy({ id: dto.provinceId });
    if (!province) throw new BadRequestException('省份不存在');
    if (dto.parentContractId) {
      const parent = await this.contractRepo.findOneBy({ id: dto.parentContractId });
      if (!parent) throw new BadRequestException('父合同不存在');
    }
    const contract = await this.contractRepo.save({
      id: randomUUID(),
      contractNo,
      contractName: dto.contractName,
      taxInclusiveAmountFen: Math.round(dto.taxInclusiveAmountFen),
      taxExclusiveAmountFen: dto.taxExclusiveAmountFen != null ? Math.round(dto.taxExclusiveAmountFen) : null,
      provinceId: dto.provinceId,
      startDate: dto.startDate ?? null,
      endDate: dto.endDate ?? null,
      status: ContractStatus.DRAFT,
      amountLocked: false,
      parentContractId: dto.parentContractId ?? null,
      versionNo: 1,
      createdBy: auth.userId,
      updatedBy: auth.userId,
    });
    await this.recordOp(auth.userId, 'contract.create', contract.id);
    return contract;
  }

  async importWorkbook(auth: BizAuthContext, filename: string, buffer: Buffer): Promise<{ created: number; contractNos: string[] }> {
    if (!filename.toLowerCase().endsWith('.xlsx')) throw new BadRequestException('仅支持 .xlsx 合同模板文件');
    if (!['super_admin', 'admin', 'contract_manager'].includes(auth.roleCode)) {
      throw new ForbiddenException('当前账号无合同导入权限');
    }

    const workbook = readWorkbookSafe(buffer, { maxRowsPerSheet: WORKBOOK_LIMITS.maxRowsPerSheet });
    if (workbook.SheetNames.length !== 1) throw new BadRequestException('合同导入文件必须包含一个工作表');
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' });
    const header = (rows[0] ?? []).map((value) => String(value).trim());
    const indexes = this.contractImportIndexes(header);
    const required = ['合同编号', '合同名称', '含税合同额（元）', '所属省份'];
    const missing = required.filter((name) => indexes.get(name) === undefined);
    if (missing.length > 0) throw new BadRequestException(`缺少必填列：${missing.join('、')}`);

    const provinceByName = new Map<string, string>();
    for (const province of await this.provinceRepo.find()) {
      provinceByName.set(province.name.trim(), province.id);
      provinceByName.set(province.code.trim(), province.id);
    }

    const pending: Array<CreateContractDto & { rowNo: number }> = [];
    const seen = new Set<string>();
    const errors: string[] = [];
    rows.slice(1).forEach((source, offset) => {
      const rowNo = offset + 2;
      const values = Array.isArray(source) ? source.map((value) => String(value ?? '').trim()) : [];
      if (values.every((value) => !value)) return;
      const read = (name: string) => {
        const index = indexes.get(name);
        return index === undefined ? '' : values[index] ?? '';
      };
      const contractNo = this.normalizePrimaryContractNo(read('合同编号'));
      const contractName = read('合同名称');
      const amountText = read('含税合同额（元）').replace(/,/g, '');
      const amount = Number(amountText);
      const provinceText = read('所属省份');
      const provinceId = provinceByName.get(provinceText);
      if (!contractNo || !contractName || !provinceId || !Number.isFinite(amount) || amount < 0) {
        errors.push(`第 ${rowNo} 行：合同编号、合同名称、所属省份和非负含税合同额为必填项`);
        return;
      }
      if (seen.has(contractNo)) {
        errors.push(`第 ${rowNo} 行：合同编号 ${contractNo} 在文件中重复`);
        return;
      }
      seen.add(contractNo);
      const startDate = this.normalizeContractDate(read('开始日期'));
      const endDate = this.normalizeContractDate(read('结束日期'));
      if ((read('开始日期') && !startDate) || (read('结束日期') && !endDate)) {
        errors.push(`第 ${rowNo} 行：开始日期或结束日期格式无效，应为 YYYY-MM-DD`);
        return;
      }
      pending.push({
        rowNo,
        contractNo,
        contractName,
        taxInclusiveAmountFen: Math.round(amount * 100),
        provinceId,
        startDate,
        endDate,
      });
    });
    if (pending.length === 0 && errors.length === 0) throw new BadRequestException('合同导入文件没有数据行');
    if (errors.length > 0) throw new BadRequestException(errors.slice(0, 20).join('；'));

    const existing = await this.contractRepo.createQueryBuilder('c')
      .select('c.contractNo', 'contractNo')
      .where('c.contractNo IN (:...contractNos)', { contractNos: pending.map((row) => row.contractNo) })
      .getRawMany<{ contractNo: string }>();
    if (existing.length > 0) throw new BadRequestException(`合同编号已存在：${existing.map((row) => row.contractNo).join('、')}`);

    const imported = pending.map((row) => ({ ...row, id: randomUUID() }));
    await this.dataSource.transaction(async (manager) => {
      await manager.insert(BizContractEntity, imported.map((row) => ({
        id: row.id,
        contractNo: row.contractNo,
        contractName: row.contractName,
        taxInclusiveAmountFen: row.taxInclusiveAmountFen,
        taxExclusiveAmountFen: null,
        provinceId: row.provinceId,
        startDate: row.startDate ?? null,
        endDate: row.endDate ?? null,
        status: ContractStatus.DRAFT,
        tags: [],
        amountLocked: false,
        parentContractId: null,
        versionNo: 1,
        createdBy: auth.userId,
        updatedBy: auth.userId,
      })));
      await manager.insert(BizOperationLogEntity, imported.map((row) => ({
        id: randomUUID(), operatorUserId: auth.userId, actionType: 'contract.import',
        targetType: 'contract', targetId: row.id, resultStatus: 'success',
      })));
    });
    return { created: pending.length, contractNos: pending.map((row) => row.contractNo) };
  }

  async importWorkbookWithAllocations(auth: BizAuthContext, filename: string, buffer: Buffer): Promise<Record<string, unknown>> {
    if (!filename.toLowerCase().endsWith('.xlsx')) throw new BadRequestException('仅支持 .xlsx 原始合同台账');
    if (!['super_admin', 'admin', 'contract_manager'].includes(auth.roleCode)) throw new ForbiddenException('当前账号无合同导入权限');
    const workbook = readWorkbookSafe(buffer, { maxRowsPerSheet: WORKBOOK_LIMITS.maxRowsPerSheet });
    const fileHash = createHash('sha256').update(buffer).digest('hex');
    if (await this.importRecordRepo.findOneBy({ fileHash })) throw new BadRequestException('该文件已上传过，请从上传记录查看结果');

    const ledgerAreaHints = this.collectLedgerAreaHints(workbook);
    const provinces = await this.provinceRepo.find();
    const provinceByKey = new Map<string, string>();
    const provinceCodeById = new Map<string, string>();
    const pendingProvinces: Array<Partial<ProvinceEntity>> = [];
    for (const province of provinces) {
      provinceByKey.set(this.normalizeLedgerName(province.name), province.id);
      provinceByKey.set(this.normalizeLedgerName(province.code), province.id);
      const standard = LEDGER_PROVINCES.find((item) => item.code === province.code);
      for (const alias of standard?.aliases ?? []) {
        provinceByKey.set(this.normalizeLedgerName(alias), province.id);
      }
      provinceCodeById.set(province.id, province.code);
    }
    for (const hint of ledgerAreaHints) {
      const known = this.findLedgerProvince(hint.provinceText);
      if (!known) continue;
      const normalizedName = this.normalizeLedgerName(known.name);
      if (provinceByKey.has(normalizedName)) continue;
      const id = this.stableUuid(`province:${known.code}`);
      const province: Partial<ProvinceEntity> = { id, code: known.code, name: known.name, status: 'active' };
      pendingProvinces.push(province);
      provinceByKey.set(normalizedName, id);
      for (const alias of known.aliases) provinceByKey.set(this.normalizeLedgerName(alias), id);
      provinceCodeById.set(id, known.code);
    }
    const units = await this.cityRepo.find({ where: { status: 'active' } });
    const aliases = await this.cityAliasRepo.find();
    const unitByKey = new Map<string, CityEntity>();
    for (const unit of units) unitByKey.set(`${unit.provinceId}|${this.normalizeLedgerName(unit.name)}`, unit);
    for (const alias of aliases) {
      const unit = units.find((item) => item.id === alias.cityId);
      if (unit) unitByKey.set(`${unit.provinceId}|${this.normalizeLedgerName(alias.alias)}`, unit);
    }
    const pendingCities: CityEntity[] = [];
    const unitKeySet = new Set(unitByKey.keys());
    for (const hint of ledgerAreaHints) {
      const provinceId = provinceByKey.get(this.normalizeLedgerName(hint.provinceText));
      if (!provinceId) continue;
      const provinceCode = provinceCodeById.get(provinceId);
      if (!provinceCode) continue;
      for (const cityToken of this.extractLedgerCityTokens(hint.cityText)) {
        const normalizedCity = this.normalizeLedgerName(cityToken);
        const key = `${provinceId}|${normalizedCity}`;
        if (unitKeySet.has(key)) continue;
        const cityId = this.stableUuid(`city:${provinceCode}:${normalizedCity}`);
        const adminSuffix = /(市|盟|旗|自治州|地区|区|县)$/;
        const cityName = adminSuffix.test(cityToken) ? cityToken : `${cityToken}市`;
        const city: CityEntity = { id: cityId, provinceId, code: `AUTO-${provinceCode}-${cityId.slice(0, 8)}`, name: cityName, unitType: 'city', status: 'active', createdAt: new Date(), updatedAt: new Date() };
        pendingCities.push(city);
        units.push(city);
        unitKeySet.add(key);
      }
    }

    const recordId = randomUUID();
    const issues: string[] = [];
    const contractNos = new Map<string, number>();
    type ParsedLedgerRow = { sourceRow: BizContractSourceRowEntity; parsed: { contractNo: string; contractName: string; provinceId: string | null; cityIds: string[]; amountFen: number | null; amountExclusiveFen: number | null; taxRateRaw: string; taxRates: number[]; signedDate: string | null; startDate: string | null; endDate: string | null; archiveNo: string; projectCode: string; category1: string; category2: string; winningProject: string }; cityText: string };
    const preparedSheets: Array<{ sheet: BizContractImportSheetEntity; rows: BizContractSourceRowEntity[]; headers: string[]; values: unknown[][]; indexes: Record<string, number>; isContractSheet: boolean; parsedRows: ParsedLedgerRow[] }> = [];
    let totalRows = 0;
    for (let sheetIndex = 0; sheetIndex < workbook.SheetNames.length; sheetIndex += 1) {
      const sheetName = workbook.SheetNames[sheetIndex];
      const sheet = workbook.Sheets[sheetName];
      const ref = sheet['!ref'] ?? 'A1:A1';
      const range = XLSX.utils.decode_range(ref);
      const values = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });
      const headers = (values[0] ?? []).map((value) => String(value ?? ''));
      const normalized = headers.map((value) => this.normalizeImportHeader(value));
      const indexOf = (names: string[]) => names.map((name) => this.normalizeImportHeader(name)).map((name) => normalized.indexOf(name)).find((index) => index >= 0) ?? -1;
      const indexes = {
        archiveNo: indexOf(['档案室合同编号']), contractNo: indexOf(['甲方合同编号', '合同编号']), projectCode: indexOf(['项目唯一识别编码']),
        category1: indexOf(['合同分类-1']), category2: indexOf(['合同分类-2']), winningProject: indexOf(['中标项目名称']), contractName: indexOf(['合同名称']),
        province: indexOf(['省份']), city: indexOf(['地市']), taxExclusive: indexOf(['合同金额（不含税，万元）']), taxRate: indexOf(['税率']), taxInclusive: indexOf(['合同金额（含税，万元）']),
        signedDate: indexOf(['签订日期']), endDate: indexOf(['合同到期时间']), period: indexOf(['合同期限']),
      };
      const isContractSheet = indexes.contractNo >= 0 && indexes.contractName >= 0 && indexes.province >= 0 && indexes.taxInclusive >= 0;
      const importSheet: BizContractImportSheetEntity = { id: randomUUID(), importRecordId: recordId, sheetIndex, sheetName, startRow: range.s.r + 1, startCol: range.s.c + 1, rowCount: range.e.r - range.s.r + 1, columnCount: range.e.c - range.s.c + 1, headerRowNo: 1, headersJson: headers, isContractSheet, createdAt: new Date() };
      const sourceRows: BizContractSourceRowEntity[] = [];
      const normalizedRows = values.map((row, offset) => {
        const fixed = Array.from({ length: importSheet.columnCount }, (_, col) => row?.[col] ?? null);
        const cells = fixed.map((value) => this.encodeLedgerCell(value));
        const blank = fixed.every((value) => value === null || value === undefined || String(value).trim() === '');
        const rowNo = offset + 1;
        sourceRows.push({ id: randomUUID(), importRecordId: recordId, sheetId: importSheet.id, sourceRowNo: rowNo, rowKind: rowNo === 1 ? 'header' : blank ? 'blank' : 'data', cellsJson: JSON.stringify(cells), normalizationStatus: isContractSheet && rowNo > 1 && !blank ? 'needs_review' : 'archived', normalizationMessage: null, provinceId: null, cityId: null, contractId: null, createdAt: new Date() });
        return fixed;
      });
      const parsedRows: ParsedLedgerRow[] = [];
      if (isContractSheet) {
        for (let offset = 1; offset < normalizedRows.length; offset += 1) {
          const raw = normalizedRows[offset];
          if (raw.every((value) => value === null || value === undefined || String(value).trim() === '')) continue;
          totalRows += 1;
          const sourceRow = sourceRows[offset];
          const read = (index: number) => index < 0 ? '' : String(raw[index] ?? '').trim();
          const contractNo = this.normalizePrimaryContractNo(read(indexes.contractNo));
          const groupKey = contractNo && !this.isPlaceholder(contractNo) ? contractNo : `__row_${recordId}_${sheetIndex}_${offset + 1}`;
          contractNos.set(groupKey, (contractNos.get(groupKey) ?? 0) + 1);
          const contractName = read(indexes.contractName);
          const provinceText = read(indexes.province);
          const provinceId = provinceByKey.get(this.normalizeLedgerName(provinceText));
        const cityText = read(indexes.city);
        const candidateCities = provinceId ? this.matchLedgerUnits(cityText, provinceId, units, aliases) : [];
        const city = candidateCities.length === 1 ? candidateCities[0] : undefined;
          const amountFen = this.parseWanToFen(raw[indexes.taxInclusive]);
          const amountExclusiveFen = this.parseWanToFen(raw[indexes.taxExclusive]);
          const taxRateRaw = read(indexes.taxRate);
          const taxRates = this.parseTaxRateBps(taxRateRaw);
          const signedDate = this.parseLedgerDate(raw[indexes.signedDate]);
          const periodDates = this.parsePeriodDates(read(indexes.period));
          const endDate = this.parseLedgerDate(raw[indexes.endDate]) ?? periodDates.endDate;
          const startDate = periodDates.startDate;
          const blockingIssues: string[] = [];
          const warnings: string[] = [];
          if (!contractNo || this.isPlaceholder(contractNo)) blockingIssues.push('甲方合同编号为空或为占位值');
          if (!contractName) blockingIssues.push('合同名称为空');
          if (!provinceId) blockingIssues.push(`省份无法精确匹配：${provinceText || '空'}`);
          if (amountFen == null || !Number.isSafeInteger(amountFen) || amountFen < 0) blockingIssues.push('含税合同金额（万元）无法解析');
          if (!signedDate && read(indexes.signedDate)) blockingIssues.push('签订日期无法解析');
          if (!endDate && read(indexes.endDate) && !this.isPlaceholder(read(indexes.endDate))) blockingIssues.push('合同到期时间无法解析');
          if (!candidateCities.length && cityText) warnings.push(`地市无法精确映射：${cityText}`);
          const messages = [...blockingIssues, ...warnings];
          sourceRow.normalizationStatus = blockingIssues.length ? 'needs_review' : 'valid';
          sourceRow.normalizationMessage = messages.length ? messages.join('；') : null;
          sourceRow.provinceId = provinceId ?? null;
          sourceRow.cityId = city?.id ?? null;
          if (messages.length) issues.push(`第 ${offset + 1} 行：${messages.join('；')}`);
          parsedRows.push({ sourceRow, cityText, parsed: { contractNo, contractName, provinceId: provinceId ?? null, cityIds: candidateCities.map((item) => item.id), amountFen, amountExclusiveFen, taxRateRaw, taxRates, signedDate, startDate, endDate, archiveNo: read(indexes.archiveNo), projectCode: read(indexes.projectCode), category1: read(indexes.category1), category2: read(indexes.category2), winningProject: read(indexes.winningProject) } });
        }
      }
      preparedSheets.push({ sheet: importSheet, rows: sourceRows, headers, values: normalizedRows, indexes, isContractSheet, parsedRows });
    }
    if (!preparedSheets.some((item) => item.isContractSheet)) throw new BadRequestException('未找到包含甲方合同编号、合同名称、省份和含税金额的合同工作表');
    const groups = new Map<string, ParsedLedgerRow[]>();
    for (const prepared of preparedSheets) for (const row of prepared.parsedRows) {
      const key = row.parsed.contractNo && !this.isPlaceholder(row.parsed.contractNo) ? row.parsed.contractNo : row.sourceRow.id;
      const list = groups.get(key) ?? []; list.push(row); groups.set(key, list);
    }
    const existingContracts = groups.size ? await this.contractRepo.find({ where: { contractNo: In([...groups.keys()].filter((key) => !key.startsWith('__row_') && !this.isPlaceholder(key))) }, select: { id: true, contractNo: true } }) : [];
    const existingByNo = new Map(existingContracts.map((contract) => [contract.contractNo, contract]));
    for (const contractNo of existingByNo.keys()) issues.push(`合同编号已存在：${contractNo}`);
    let validRows = 0; let reviewRows = 0; let allocationCount = 0; const createdContractNos: string[] = [];
    const plannedContracts: Array<{ id: string; first: ParsedLedgerRow['parsed']; rows: ParsedLedgerRow[]; cityIds: string[] }> = [];
    for (const [groupKey, rows] of groups) {
      const first = rows[0].parsed;
      const inconsistency: string[] = [];
      const compare = (label: string, values: unknown[]) => { const normalized = values.map((value) => value == null ? '' : String(value)); if (new Set(normalized).size > 1) inconsistency.push(label); };
      compare('合同名称', rows.map((row) => row.parsed.contractName)); compare('省份', rows.map((row) => row.parsed.provinceId)); compare('含税合同金额（万元）', rows.map((row) => row.parsed.amountFen)); compare('签订日期', rows.map((row) => row.parsed.signedDate)); compare('合同开始日期', rows.map((row) => row.parsed.startDate)); compare('合同到期日期', rows.map((row) => row.parsed.endDate));
      const groupIssue = inconsistency.length ? `同合同编号组字段不一致：${inconsistency.join('、')}` : existingByNo.has(groupKey) ? `合同编号已存在：${groupKey}` : null;
      const amountInvalid = first.amountFen == null || !Number.isSafeInteger(first.amountFen) || first.amountFen < 0;
      const coreInvalid = !first.contractNo || this.isPlaceholder(first.contractNo) || !first.contractName || !first.provinceId || amountInvalid;
      const coreIssues = [
        !first.contractNo || this.isPlaceholder(first.contractNo) ? '合同编号为空或为占位值' : null,
        !first.contractName ? '合同名称为空' : null,
        !first.provinceId ? '省份无法精确匹配' : null,
        amountInvalid ? '含税合同金额（万元）无法解析' : null,
      ].filter((value): value is string => Boolean(value));
      const cityIds = [...new Set(rows.flatMap((row) => row.parsed.cityIds))].sort();
      const shouldCreate = !groupIssue && !coreInvalid;
      let contractId: string | null = null;
      if (shouldCreate) { contractId = randomUUID(); plannedContracts.push({ id: contractId, first, rows, cityIds }); createdContractNos.push(first.contractNo); }
      for (const row of rows) {
        const rowIssues = [groupIssue, ...coreIssues, row.parsed.cityIds.length === 0 && row.cityText ? `地市无法精确映射：${row.cityText}` : null].filter((value): value is string => Boolean(value));
        row.sourceRow.normalizationStatus = rowIssues.length ? 'needs_review' : 'valid'; row.sourceRow.normalizationMessage = rowIssues.length ? rowIssues.join('；') : null; row.sourceRow.provinceId = row.parsed.provinceId; row.sourceRow.cityId = row.parsed.cityIds.length === 1 ? row.parsed.cityIds[0] : null; row.sourceRow.contractId = contractId;
        if (rowIssues.length) { reviewRows += 1; issues.push(`第 ${row.sourceRow.sourceRowNo} 行：${rowIssues.join('；')}`); } else validRows += 1;
      }
    }
    const record: BizContractImportRecordEntity = { id: recordId, filename, fileHash, status: 'imported', sheetCount: preparedSheets.length, totalRows, validRows: 0, reviewRows: 0, uploadedBy: auth.userId, dataScopeJson: JSON.stringify({ scopeType: auth.dataScope.scopeType, provinceIds: auth.dataScope.provinceIds ?? [], cityId: auth.dataScope.cityId ?? null }), completedAt: new Date(), failureReason: issues.length ? issues.slice(0, 100).join('；') : null, uploadedAt: new Date(), updatedAt: new Date() };
    try {
      await this.dataSource.transaction(async (manager) => {
      if (pendingProvinces.length > 0) await manager.insert(ProvinceEntity, pendingProvinces);
      if (pendingCities.length > 0) await manager.insert(CityEntity, pendingCities);
      for (const province of pendingProvinces) {
        await manager.insert(BizOperationLogEntity, { id: randomUUID(), operatorUserId: auth.userId, actionType: 'master_data.province.auto_configure', targetType: 'province', targetId: String(province.id), resultStatus: 'success', batchId: recordId });
      }
      for (const city of pendingCities) {
        await manager.insert(BizOperationLogEntity, { id: randomUUID(), operatorUserId: auth.userId, actionType: 'master_data.city.auto_configure', targetType: 'city', targetId: city.id, resultStatus: 'success', batchId: recordId });
      }
      await manager.insert(BizContractImportRecordEntity, record);
      for (const prepared of preparedSheets) {
        await manager.insert(BizContractImportSheetEntity, prepared.sheet);
        await manager.insert(BizContractSourceRowEntity, prepared.rows.map((row) => ({ ...row, contractId: null })));
      }
        for (const planned of plannedContracts) {
          const first = planned.first;
          await manager.insert(BizContractEntity, { id: planned.id, contractNo: first.contractNo, contractName: first.contractName, taxInclusiveAmountFen: first.amountFen as number, taxExclusiveAmountFen: first.amountExclusiveFen, archiveContractNo: first.archiveNo || null, projectIdentityCode: first.projectCode || null, contractCategory1: first.category1 || null, contractCategory2: first.category2 || null, winningProjectName: first.winningProject || null, signedDate: first.signedDate, taxRateRaw: first.taxRateRaw || null, taxRateBp: first.taxRates.length === 1 ? first.taxRates[0] : null, taxRateBpsJson: first.taxRates.length ? first.taxRates : null, sourceImportRecordId: recordId, sourceSheetId: planned.rows[0].sourceRow.sheetId, sourceRowId: planned.rows[0].sourceRow.id, sourceRowNo: planned.rows[0].sourceRow.sourceRowNo, provinceId: first.provinceId as string, startDate: first.startDate, endDate: first.endDate, status: ContractStatus.ACTIVE, tags: [], amountLocked: true, parentContractId: null, versionNo: 1, createdBy: auth.userId, updatedBy: auth.userId });
          for (const [cityId, quotaFen] of this.averageAllocationFens(first.amountFen as number, planned.cityIds)) { await manager.insert(BizContractCityAllocationEntity, { id: randomUUID(), contractId: planned.id, cityId, quotaFen, status: 'active', versionNo: 1 }); allocationCount += 1; }
          await manager.insert(BizOperationLogEntity, { id: randomUUID(), operatorUserId: auth.userId, actionType: 'contract.import', targetType: 'contract', targetId: planned.id, resultStatus: 'success', batchId: recordId });
        }
        for (const prepared of preparedSheets) for (const row of prepared.rows) if (row.contractId) await manager.update(BizContractSourceRowEntity, { id: row.id }, { contractId: row.contractId, normalizationStatus: row.normalizationStatus, normalizationMessage: row.normalizationMessage, provinceId: row.provinceId, cityId: row.cityId });
        const actualReview = await manager.count(BizContractSourceRowEntity, { where: { importRecordId: recordId, normalizationStatus: 'needs_review' } }); const actualValid = await manager.count(BizContractSourceRowEntity, { where: { importRecordId: recordId, normalizationStatus: 'valid' } });
        await manager.update(BizContractImportRecordEntity, { id: recordId }, { validRows: actualValid, reviewRows: actualReview }); await manager.insert(BizOperationLogEntity, { id: randomUUID(), operatorUserId: auth.userId, actionType: 'contract.import_record', targetType: 'contract_import_record', targetId: recordId, resultStatus: actualReview ? 'needs_review' : 'success', batchId: recordId });
      });
    } catch (error: unknown) {
      if (!this.isDuplicateDatabaseError(error)) throw error;
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (/file.?hash|uk_biz_contract_import/i.test(errorMessage)) throw new BadRequestException('该文件已上传过，请从上传记录查看结果');
      const conflictRecord: BizContractImportRecordEntity = { ...record, validRows: 0, reviewRows: totalRows, failureReason: '合同编号已存在，相关原始行已保存为待维护' };
      const parsedByRowId = new Map(preparedSheets.flatMap((prepared) => prepared.parsedRows.map((row) => [row.sourceRow.id, row.parsed] as const)));
      await this.dataSource.transaction(async (manager) => {
        await manager.insert(BizContractImportRecordEntity, conflictRecord);
        for (const prepared of preparedSheets) {
          await manager.insert(BizContractImportSheetEntity, prepared.sheet);
          const conflictRows = prepared.rows.map((row) => { const parsed = parsedByRowId.get(row.id); return { ...row, contractId: null, normalizationStatus: row.rowKind === 'data' ? 'needs_review' : row.normalizationStatus, normalizationMessage: row.rowKind === 'data' ? [row.normalizationMessage, parsed?.contractNo ? `合同编号已存在：${parsed.contractNo}` : '合同编号无法处理'].filter(Boolean).join('；') : row.normalizationMessage }; });
          await manager.insert(BizContractSourceRowEntity, conflictRows);
        }
        await manager.insert(BizOperationLogEntity, { id: randomUUID(), operatorUserId: auth.userId, actionType: 'contract.import_record', targetType: 'contract_import_record', targetId: recordId, resultStatus: 'needs_review', batchId: recordId, summaryAfter: '合同唯一键并发冲突，原始行已转待维护' });
      });
      return { importRecordId: recordId, created: 0, contractNos: [], allocations: 0, sheetCount: preparedSheets.length, totalRows, validRows: 0, reviewRows: totalRows, issues: ['合同编号已存在或发生并发冲突，原始行已保存为待维护'] };
    }
    return { importRecordId: recordId, created: createdContractNos.length, contractNos: createdContractNos, allocations: allocationCount, sheetCount: preparedSheets.length, totalRows, validRows, reviewRows, issues: issues.slice(0, 100) };
  }

  private assertImportRecordDownloadScope(auth: BizAuthContext): void {
    if (auth.isSuperAdmin || auth.dataScope.scopeType === 'all' || auth.dataScope.scopeType === 'contract') return;
    throw new ForbiddenException('原始台账下载仅限合同全量数据范围账号');
  }

  async listImportRecords(auth: BizAuthContext): Promise<BizContractImportRecordEntity[]> {
    this.assertImportRecordDownloadScope(auth);
    return this.importRecordRepo.find({ order: { uploadedAt: 'DESC' }, take: 100 });
  }

  async importRecordDetail(auth: BizAuthContext, id: string): Promise<{ record: BizContractImportRecordEntity; sheets: BizContractImportSheetEntity[]; issues: BizContractSourceRowEntity[] }> {
    this.assertImportRecordDownloadScope(auth);
    const record = await this.importRecordRepo.findOneBy({ id });
    if (!record) throw new NotFoundException('上传记录不存在');
    const [sheets, issues] = await Promise.all([
      this.importSheetRepo.find({ where: { importRecordId: id }, order: { sheetIndex: 'ASC' } }),
      this.sourceRowRepo.find({ where: { importRecordId: id, normalizationStatus: 'needs_review' }, order: { sourceRowNo: 'ASC' }, take: 500 }),
    ]);
    return { record, sheets, issues };
  }

  async exportImportRecord(auth: BizAuthContext, id: string): Promise<{ filename: string; buffer: Buffer }> {
    this.assertImportRecordDownloadScope(auth);
    const record = await this.importRecordRepo.findOneBy({ id });
    if (!record) throw new NotFoundException('上传记录不存在');
    const sheets = await this.importSheetRepo.find({ where: { importRecordId: id }, order: { sheetIndex: 'ASC' } });
    const workbook = XLSX.utils.book_new();
    for (const sheet of sheets) {
      const rows = await this.sourceRowRepo.find({ where: { importRecordId: id, sheetId: sheet.id }, order: { sourceRowNo: 'ASC' } });
      const values = rows.map((row) => ((typeof row.cellsJson === 'string' ? JSON.parse(row.cellsJson) : row.cellsJson) as unknown[]).map((cell) => {
        if (cell && typeof cell === 'object' && 'kind' in cell && (cell as { kind?: string }).kind === 'date') return new Date(String((cell as unknown as { value: string }).value));
        return cell;
      }));
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(values), sheet.sheetName.slice(0, 31) || `Sheet${sheet.sheetIndex + 1}`);
    }
    await this.recordOp(auth.userId, 'contract.import_record.download', id);
    return { filename: `原始合同台账-${record.filename.replace(/\.xlsx$/i, '')}.xlsx`, buffer: Buffer.from(XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' })) };
  }

  async deleteImportRecord(auth: BizAuthContext, id: string): Promise<void> {
    this.assertImportRecordDownloadScope(auth);
    const record = await this.importRecordRepo.findOneBy({ id });
    if (!record) throw new NotFoundException('上传记录不存在');
    const contracts = await this.contractRepo.findBy({ sourceImportRecordId: id });
    const contractIds = contracts.map((contract) => contract.id);
    if (contracts.some((contract) => contract.status !== ContractStatus.DRAFT || contract.amountLocked)) {
      throw new BadRequestException('该上传记录已创建执行中或已锁定合同，不能删除');
    }
    if (contractIds.length > 0) {
      const [orderCount, offlineCount] = await Promise.all([
        this.orderRowRepo.count({ where: { contractId: In(contractIds) } }),
        this.offlineRepo.count({ where: { contractId: In(contractIds) } }),
      ]);
      if (orderCount > 0 || offlineCount > 0) throw new BadRequestException('该上传记录关联的合同已有订单或线下完工，不能删除');
    }
    await this.dataSource.transaction(async (manager) => {
      if (contractIds.length > 0) {
        await manager.delete(BizContractFeeRateEntity, { contractId: In(contractIds) });
        await manager.delete(BizContractCityAllocationEntity, { contractId: In(contractIds) });
        await manager.delete(BizContractAlertEntity, { contractId: In(contractIds) });
        await manager.delete(BizContractEntity, { id: In(contractIds), sourceImportRecordId: id });
      }
      await manager.delete(BizContractSourceRowEntity, { importRecordId: id });
      await manager.delete(BizContractImportSheetEntity, { importRecordId: id });
      await manager.delete(BizContractImportRecordEntity, { id });
      await manager.insert(BizOperationLogEntity, {
        id: randomUUID(), operatorUserId: auth.userId, actionType: 'contract.import_record.delete',
        targetType: 'contract_import_record', targetId: id, resultStatus: 'success', batchId: id,
      });
    });
  }

  async batchClearDrafts(auth: BizAuthContext, ids: string[]): Promise<{ cleared: number; skipped: Array<{ id: string; contractNo?: string; reason: string }> }> {
    const uniqueIds = [...new Set((ids ?? []).map((id) => String(id).trim()).filter(Boolean))];
    if (!uniqueIds.length) throw new BadRequestException('请至少选择一份合同');
    const contracts = await this.contractRepo.findBy({ id: In(uniqueIds) });
    const byId = new Map(contracts.map((contract) => [contract.id, contract]));
    const skipped: Array<{ id: string; contractNo?: string; reason: string }> = [];
    const clearIds: string[] = [];
    for (const id of uniqueIds) {
      const contract = byId.get(id);
      if (!contract) { skipped.push({ id, reason: '合同不存在' }); continue; }
      if (contract.status !== ContractStatus.DRAFT) { skipped.push({ id, contractNo: contract.contractNo, reason: '仅能清空草稿合同' }); continue; }
      const [orders, completions] = await Promise.all([this.orderRowRepo.countBy({ contractId: id }), this.offlineRepo.countBy({ contractId: id })]);
      if (orders || completions) { skipped.push({ id, contractNo: contract.contractNo, reason: '合同已有订单或线下完工，不能清空' }); continue; }
      clearIds.push(id);
    }
    if (clearIds.length) await this.dataSource.transaction(async (manager) => {
      await manager.delete(BizContractFeeRateEntity, { contractId: In(clearIds) });
      await manager.delete(BizContractCityAllocationEntity, { contractId: In(clearIds) });
      await manager.delete(BizContractAlertEntity, { contractId: In(clearIds) });
      await manager.delete(BizOperationLogEntity, { targetType: 'contract', targetId: In(clearIds) });
      await manager.delete(BizContractEntity, { id: In(clearIds) });
      await manager.insert(BizOperationLogEntity, { id: randomUUID(), operatorUserId: auth.userId, actionType: 'contract.batch_clear_drafts', targetType: 'contract_batch', targetId: randomUUID(), resultStatus: 'success' });
    });
    return { cleared: clearIds.length, skipped };
  }

  private normalizeImportHeader(value: string): string {
    return value.replace(/\s/g, '').replace(/\(/g, '（').replace(/\)/g, '）');
  }

  private normalizeLedgerName(value: string): string {
    return value.trim().replace(/\s/g, '').replace(/(自治区|省|市|县|区)$/, '');
  }

  private normalizePrimaryContractNo(value: string): string {
    const first = value.split(/[\/／\r\n]+/).map((part) => part.trim()).find(Boolean) ?? '';
    return first.replace(/-\d{1,2}$/, '').trim();
  }

  private stableUuid(seed: string): string {
    const hex = createHash('sha256').update(seed).digest('hex');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
  }

  private findLedgerProvince(value: string): { code: string; name: string; aliases: string[] } | null {
    const normalized = this.normalizeLedgerName(value);
    return LEDGER_PROVINCES.find((item) => [item.name, ...item.aliases].some((alias) => this.normalizeLedgerName(alias) === normalized)) ?? null;
  }

  private collectLedgerAreaHints(workbook: XLSX.WorkBook): Array<{ provinceText: string; cityText: string }> {
    const hints: Array<{ provinceText: string; cityText: string }> = [];
    for (const sheetName of workbook.SheetNames) {
      const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, raw: true, defval: null });
      const header = (rows[0] ?? []).map((value) => this.normalizeImportHeader(String(value ?? '')));
      const provinceIndex = ['省份', '省份名称', '所属省份'].map((value) => header.indexOf(this.normalizeImportHeader(value))).find((index) => index >= 0) ?? -1;
      const cityIndex = ['地市', '地市名称', '市公司'].map((value) => header.indexOf(this.normalizeImportHeader(value))).find((index) => index >= 0) ?? -1;
      if (provinceIndex < 0 || cityIndex < 0) continue;
      for (const row of rows.slice(1)) {
        const provinceText = String(row?.[provinceIndex] ?? '').trim();
        const cityText = String(row?.[cityIndex] ?? '').trim();
        if (provinceText || cityText) hints.push({ provinceText, cityText });
      }
    }
    return hints;
  }

  private decodeSourceCells(serialized: string): unknown[] {
    try { return JSON.parse(serialized) as unknown[]; } catch { return []; }
  }

  private cellByHeader(headers: string[], cells: unknown[], names: string[]): string {
    const normalized = headers.map((header) => this.normalizeImportHeader(header));
    const index = names.map((name) => normalized.indexOf(this.normalizeImportHeader(name))).find((item) => item >= 0) ?? -1;
    const value = cells[index];
    if (value && typeof value === 'object' && 'kind' in value && (value as { kind?: string }).kind === 'date') return String((value as { value?: string }).value ?? '').slice(0, 10);
    return index >= 0 ? String(value ?? '').trim() : '';
  }

  private extractLedgerCityTokens(value: string): string[] {
    const text = value.replace(/[\r\n、，,；;\/]+/g, '、');
    const tokens = text.split('、').map((part) => part.trim()).filter(Boolean);
    return [...new Set(tokens.flatMap((token) => {
      const matches = token.match(/[\u4e00-\u9fa5]{2,8}市/g) ?? [];
      if (matches.length > 0) return matches;
      // 保留盟/旗/自治州/地区/区/县等合法行政区划后缀（不再整体丢弃），仅排除省级后缀
      if (/^[\u4e00-\u9fa5]{2,6}$/.test(token) && !/(省|自治区)$/.test(token)) return [token];
      return [];
    }))];
  }

  private matchLedgerUnits(value: string, provinceId: string, units: CityEntity[], aliases: CityAliasEntity[]): CityEntity[] {
    const text = this.normalizeLedgerName(value);
    if (!text) return [];
    const names = new Map<string, CityEntity>();
    for (const unit of units.filter((item) => item.provinceId === provinceId)) {
      names.set(this.normalizeLedgerName(unit.name), unit);
      names.set(this.normalizeLedgerName(unit.name.replace(/市$/, '')), unit);
    }
    for (const alias of aliases) {
      const unit = units.find((item) => item.id === alias.cityId && item.provinceId === provinceId);
      if (unit) names.set(this.normalizeLedgerName(alias.alias), unit);
    }
    const matches: CityEntity[] = [];
    for (const [name, unit] of names) {
      if (name.length >= 2 && text.includes(name)) matches.push(unit);
    }
    return [...new Map(matches.map((unit) => [unit.id, unit])).values()].sort((a, b) => b.name.length - a.name.length);
  }

  private averageAllocationFens(totalFen: number, cityIds: string[]): Array<[string, number]> {
    const ids = [...new Set(cityIds)].sort();
    if (ids.length === 0) return [];
    const quotient = Math.trunc(totalFen / ids.length);
    const remainder = totalFen - quotient * ids.length;
    return ids.map((cityId, index) => [cityId, quotient + (index < remainder ? 1 : 0)]);
  }

  private isPlaceholder(value: string): boolean {
    return ['无', '暂无', 'null', 'NULL', '-', '—', ''].includes(value.trim());
  }

  private encodeLedgerCell(value: unknown): unknown {
    if (value instanceof Date) return { kind: 'date', value: value.toISOString() };
    if (value === undefined || value === null) return null;
    return value;
  }

  /** 台账金额统一按“万元”读取，先换算为元，再换算为整数分。 */
  private parseWanToFen(value: unknown): number | null {
    if (value === null || value === undefined || this.isPlaceholder(String(value))) return null;
    const text = String(value).replace(/[￥¥元,，\s]/g, '').trim();
    if (!/^[-+]?\d+(?:\.\d+)?$/.test(text)) return null;
    const [integer, fraction = ''] = text.replace(/^\+/, '').split('.');
    const sign = text.startsWith('-') ? -1 : 1;
    const scaled = BigInt(integer.replace('-', '')) * 1_000_000n + BigInt((fraction + '000000').slice(0, 6));
    const fen = Number(BigInt(sign) * scaled);
    return Number.isSafeInteger(fen) ? fen : null;
  }

  private isDuplicateDatabaseError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const candidate = error as { code?: unknown; errno?: unknown; message?: unknown; driverError?: { code?: unknown; errno?: unknown; message?: unknown } };
    const code = String(candidate.code ?? candidate.driverError?.code ?? '');
    const errno = String(candidate.errno ?? candidate.driverError?.errno ?? '');
    const message = String(candidate.message ?? candidate.driverError?.message ?? '');
    return code === 'ER_DUP_ENTRY' || errno === '1062' || /duplicate entry|unique constraint|unique failed|constraint failed/i.test(message);
  }

  private parseTaxRateBps(value: string): number[] {
    if (!value || this.isPlaceholder(value)) return [];
    const values = value.replace(/％/g, '%').split(/[\/、,，]/).map((item) => item.trim()).filter(Boolean);
    const result: number[] = [];
    for (const item of values) {
      const numericText = item.replace(/%$/, '');
      const numeric = Number(numericText);
      if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100) continue;
      result.push(Math.round((item.endsWith('%') ? numeric : numeric <= 1 ? numeric * 100 : numeric) * 100));
    }
    return [...new Set(result)];
  }

  private parseLedgerDate(value: unknown): string | null {
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86400000));
      return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
    }
    const text = String(value ?? '').trim();
    if (!text || this.isPlaceholder(text)) return null;
    const match = text.match(/^(\d{4})[./-](\d{1,2})[./-](\d{1,2})$/);
    if (!match) return null;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
  }

  private parsePeriodDates(value: string): { startDate: string | null; endDate: string | null } {
    const matches = value.match(/\d{4}[./-]\d{1,2}[./-]\d{1,2}/g) ?? [];
    return { startDate: this.parseLedgerDate(matches[0]), endDate: this.parseLedgerDate(matches[1]) };
  }

  private normalizeAreaName(value: string): string {
    return value.trim().replace(/\s/g, '').replace(/分公司$/, '').replace(/公司$/, '').replace(/市$/, '').replace(/省$/, '');
  }

  private parseImportRate(value: string): number | null {
    const text = value.trim().replace(/,/g, '');
    if (!text) return null;
    const numeric = Number(text.replace(/%$/, ''));
    if (!Number.isFinite(numeric) || numeric <= 0) return null;
    const percent = text.endsWith('%') ? numeric : numeric <= 1 ? numeric * 100 : numeric;
    if (percent > 100) return null;
    return Math.round(percent * 100);
  }

  private parseImportPeriod(value: string): { startDate: string | null; endDate: string | null } {
    const matches = value.match(/\d{4}[./-]\d{1,2}[./-]\d{1,2}/g) ?? [];
    return { startDate: this.normalizeContractDate(matches[0] ?? ''), endDate: this.normalizeContractDate(matches[1] ?? '') };
  }

  private contractImportIndexes(header: string[]): Map<string, number> {
    const aliases: Record<string, string[]> = {
      '合同编号': ['合同编号', '合同号'],
      '合同名称': ['合同名称', '合同名'],
      '含税合同额（元）': ['含税合同额（元）', '含税合同额(元)', '含税合同额', '合同金额（元）', '合同金额'],
      '所属省份': ['所属省份', '省份', '省份名称'],
      '开始日期': ['开始日期', '合同开始日期'],
      '结束日期': ['结束日期', '合同结束日期'],
    };
    const normalize = (value: string) => value.replace(/\s/g, '').replace(/\(/g, '（').replace(/\)/g, '）');
    const normalized = header.map(normalize);
    return new Map(Object.entries(aliases).flatMap(([field, names]) => {
      const index = normalized.findIndex((value) => names.some((name) => value === normalize(name)));
      return index < 0 ? [] : [[field, index] as const];
    }));
  }

  private normalizeContractDate(value: string): string | null {
    if (!value) return null;
    const parsed = new Date(value.replace(/[/.]/g, '-'));
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString().slice(0, 10);
  }

  /** 编辑：合同生效后仍允许修改合同资料和合同额。 */
  async update(auth: BizAuthContext, id: string, dto: UpdateContractDto): Promise<BizContractEntity> {
    const contract = await this.getContractOrFail(id);
    await this.assertContractVisible(auth, contract);
    if (contract.status === ContractStatus.VOIDED) throw new BadRequestException('合同已作废，不可编辑');
    if (dto.taxInclusiveAmountFen !== undefined) contract.taxInclusiveAmountFen = Math.round(dto.taxInclusiveAmountFen);
    if (dto.taxExclusiveAmountFen !== undefined) contract.taxExclusiveAmountFen = dto.taxExclusiveAmountFen != null ? Math.round(dto.taxExclusiveAmountFen) : null;
    if (dto.contractName !== undefined) contract.contractName = dto.contractName;
    if (dto.startDate !== undefined) contract.startDate = dto.startDate;
    if (dto.endDate !== undefined) contract.endDate = dto.endDate;
    contract.versionNo += 1;
    contract.updatedBy = auth.userId;
    await this.contractRepo.save(contract);
    await this.recordOp(auth.userId, 'contract.update', id);
    return contract;
  }

  // ================= 状态机 =================

  /** 完整性校验：编号/名称/含税金额>0/起止日期/至少一个经营单位分配；管理费率不阻断生效。 */
  private async completenessIssues(contract: BizContractEntity): Promise<string[]> {
    const missing: string[] = [];
    if (!contract.contractNo?.trim()) missing.push('合同编号');
    if (!contract.contractName?.trim()) missing.push('合同名称');
    if (!Number(contract.taxInclusiveAmountFen) || Number(contract.taxInclusiveAmountFen) <= 0) missing.push('含税合同金额(>0)');
    if (!contract.startDate) missing.push('合同开始日期');
    if (!contract.endDate) missing.push('合同结束日期');
    if (missing.length) return missing;

    const allocations = await this.allocationRepo.findBy({ contractId: contract.id, status: 'active' });
    if (allocations.length === 0) throw new BadRequestException('合同资料不完整，缺少：地市分配');
    return missing;
  }

  private async assertCompleteness(contract: BizContractEntity): Promise<void> {
    const missing = await this.completenessIssues(contract);
    if (missing.length) throw new BadRequestException(`合同资料不完整，缺少：${missing.join('、')}`);
  }

  /** 生效：draft → active；合同额锁定；versionNo++ */
  async activate(auth: BizAuthContext, id: string): Promise<BizContractEntity> {
    const contract = await this.getContractOrFail(id);
    await this.assertContractVisible(auth, contract);
    if (contract.status !== ContractStatus.DRAFT) throw new BadRequestException('仅草稿合同可生效');
    await this.assertCompleteness(contract);
    contract.status = ContractStatus.ACTIVE;
    contract.amountLocked = true; // 生效后合同额永久锁定
    contract.versionNo += 1;
    contract.updatedBy = auth.userId;
    await this.contractRepo.save(contract);
    await this.recordOp(auth.userId, 'contract.activate', id);
    return contract;
  }

  async batchActivate(auth: BizAuthContext, ids: string[], dryRun = false): Promise<{ checked: number; activated: string[]; failed: Array<{ id: string; contractNo?: string; reason: string }> }> {
    const uniqueIds = [...new Set((ids ?? []).map((id) => String(id).trim()).filter(Boolean))];
    if (!uniqueIds.length) throw new BadRequestException('请至少选择一份草稿合同');
    const activated: string[] = [];
    const failed: Array<{ id: string; contractNo?: string; reason: string }> = [];
    for (const id of uniqueIds) {
      const contract = await this.contractRepo.findOneBy({ id });
      if (!contract) { failed.push({ id, reason: '合同不存在' }); continue; }
      try { await this.assertContractVisible(auth, contract); } catch { failed.push({ id, contractNo: contract.contractNo, reason: '数据范围不足' }); continue; }
      if (contract.status !== ContractStatus.DRAFT) { failed.push({ id, contractNo: contract.contractNo, reason: '仅草稿合同可生效' }); continue; }
      const issues = await this.completenessIssues(contract);
      if (issues.length) { failed.push({ id, contractNo: contract.contractNo, reason: `合同资料不完整，缺少：${issues.join('、')}` }); continue; }
      if (dryRun) { activated.push(id); continue; }
      contract.status = ContractStatus.ACTIVE;
      contract.amountLocked = true;
      contract.versionNo += 1;
      contract.updatedBy = auth.userId;
      await this.contractRepo.save(contract);
      await this.recordOp(auth.userId, 'contract.activate', id);
      activated.push(id);
    }
    return { checked: uniqueIds.length, activated, failed };
  }

  /** 确认完成：active → completed（进度必须 ≥100%，管理员确认） */
  async complete(auth: BizAuthContext, id: string): Promise<BizContractEntity> {
    const contract = await this.getContractOrFail(id);
    await this.assertContractVisible(auth, contract);
    if (contract.status !== ContractStatus.ACTIVE) throw new BadRequestException('仅执行中的合同可确认完成');
    const detail = await this.detail(auth, id);
    if (detail.progress.progress < 100) throw new BadRequestException('合同进度未达 100%，不可确认完成');
    contract.status = ContractStatus.COMPLETED;
    contract.versionNo += 1;
    contract.updatedBy = auth.userId;
    await this.contractRepo.save(contract);
    await this.recordOp(auth.userId, 'contract.complete', id);
    return contract;
  }

  /** 作废：active/completed → voided；必填汇总口径与原因 */
  async voidContract(auth: BizAuthContext, id: string, dto: VoidContractDto): Promise<BizContractEntity> {
    const contract = await this.getContractOrFail(id);
    await this.assertContractVisible(auth, contract);
    if (![ContractStatus.ACTIVE, ContractStatus.COMPLETED].includes(contract.status as ContractStatus)) {
      throw new BadRequestException('仅执行中或已完成的合同可作废');
    }
    if (!dto.summaryChoice || !dto.reason?.trim()) throw new BadRequestException('作废必须选择汇总口径并填写原因');
    contract.status = ContractStatus.VOIDED;
    contract.voidSummaryChoice = dto.summaryChoice;
    contract.versionNo += 1;
    contract.updatedBy = auth.userId;
    await this.contractRepo.save(contract);
    await this.recordOp(auth.userId, 'contract.void', id);
    return contract;
  }

  /** 恢复合同：支持两类场景
   *  - 已软删除（deletedAt 非 NULL）：清除删除标记，回到删除前业务状态（草稿/执行中/已完成/已作废均可），保留删除记录；
   *  - 已作废（status=voided 且未软删除）：voided → active，沿用原汇总选择，不自动恢复已取消分配。
   * 权限：operation.contract.restore（super_admin 通配）。
   */
  async restore(auth: BizAuthContext, id: string): Promise<BizContractEntity> {
    if (!auth.isSuperAdmin && !auth.permissionCodes.has('operation.contract.restore')) {
      throw new ForbiddenException('当前账号无恢复合同权限');
    }
    const contract = await this.getContractOrFail(id);
    await this.assertContractVisible(auth, contract);
    const before = `status=${contract.status};deleted=${contract.deletedAt ? 'Y' : 'N'}`;
    if (contract.deletedAt) {
      contract.deletedAt = null;
      contract.deletedBy = null;
      contract.deletedBatchId = null;
    } else if (contract.status === ContractStatus.VOIDED) {
      contract.status = ContractStatus.ACTIVE;
    } else {
      throw new BadRequestException('仅已删除或已作废合同可恢复');
    }
    contract.versionNo += 1;
    contract.updatedBy = auth.userId;
    await this.contractRepo.save(contract);
    await this.recordOp(auth.userId, 'contract.restore', id, 'success', { summaryBefore: before, summaryAfter: `status=${contract.status};deleted=N` });
    return contract;
  }

  // ================= 真正删除（软删除，保留记录与恢复入口） =================

  /** 单条删除（软删除）：标记 deletedAt/deletedBy，保留删除记录；与作废(void)解耦，不再受合同状态限制。 */
  async remove(auth: BizAuthContext, id: string): Promise<BizContractEntity> {
    if (!auth.isSuperAdmin && !auth.permissionCodes.has('operation.contract.delete')) {
      throw new ForbiddenException('当前账号无删除合同权限');
    }
    const contract = await this.getContractOrFail(id);
    await this.assertContractVisible(auth, contract);
    if (contract.deletedAt) throw new BadRequestException('合同已处于删除状态');
    const before = `contractNo=${contract.contractNo};status=${contract.status}`;
    contract.deletedAt = new Date();
    contract.deletedBy = auth.userId;
    contract.deletedBatchId = null;
    contract.versionNo += 1;
    contract.updatedBy = auth.userId;
    await this.contractRepo.save(contract);
    await this.recordOp(auth.userId, 'contract.delete', id, 'success', { summaryBefore: before, summaryAfter: `deletedAt=${contract.deletedAt.toISOString()}` });
    return contract;
  }

  /** 批量删除（软删除）：逐条校验并标记；返回成功/跳过明细，整批写入同一 batchId 便于审计。 */
  async batchRemove(auth: BizAuthContext, ids: string[]): Promise<{ checked: number; deleted: string[]; skipped: Array<{ id: string; contractNo?: string; reason: string }> }> {
    if (!auth.isSuperAdmin && !auth.permissionCodes.has('operation.contract.batch_delete')) {
      throw new ForbiddenException('当前账号无批量删除合同权限');
    }
    const uniqueIds = [...new Set((ids ?? []).map((id) => String(id).trim()).filter(Boolean))];
    if (!uniqueIds.length) throw new BadRequestException('请至少选择一份合同');
    const batchId = randomUUID();
    const contracts = await this.contractRepo.findBy({ id: In(uniqueIds) });
    const byId = new Map(contracts.map((c) => [c.id, c]));
    const skipped: Array<{ id: string; contractNo?: string; reason: string }> = [];
    const deleted: string[] = [];
    for (const id of uniqueIds) {
      const contract = byId.get(id);
      if (!contract) { skipped.push({ id, reason: '合同不存在' }); continue; }
      if (contract.deletedAt) { skipped.push({ id, contractNo: contract.contractNo, reason: '合同已删除' }); continue; }
      contract.deletedAt = new Date();
      contract.deletedBy = auth.userId;
      contract.deletedBatchId = batchId;
      contract.versionNo += 1;
      contract.updatedBy = auth.userId;
      await this.contractRepo.save(contract);
      await this.recordOp(auth.userId, 'contract.batch_delete', id, 'success', {
        targetType: 'contract_batch', batchId, summaryBefore: `contractNo=${contract.contractNo};status=${contract.status}`, summaryAfter: `deletedAt=${contract.deletedAt.toISOString()}`,
      });
      deleted.push(id);
    }
    if (deleted.length) await this.recordOp(auth.userId, 'contract.batch_delete_summary', batchId, 'success', { targetType: 'contract_batch', batchId, summaryAfter: `deleted=${deleted.length};skipped=${skipped.length}` });
    return { checked: uniqueIds.length, deleted, skipped };
  }

  /** 批量恢复：清除所选已删除合同的删除标记（沿用各自业务状态）。 */
  async batchRestore(auth: BizAuthContext, ids: string[]): Promise<{ checked: number; restored: string[]; skipped: Array<{ id: string; contractNo?: string; reason: string }> }> {
    if (!auth.isSuperAdmin && !auth.permissionCodes.has('operation.contract.restore')) {
      throw new ForbiddenException('当前账号无恢复合同权限');
    }
    const uniqueIds = [...new Set((ids ?? []).map((id) => String(id).trim()).filter(Boolean))];
    if (!uniqueIds.length) throw new BadRequestException('请至少选择一份合同');
    const batchId = randomUUID();
    const contracts = await this.contractRepo.findBy({ id: In(uniqueIds) });
    const byId = new Map(contracts.map((c) => [c.id, c]));
    const skipped: Array<{ id: string; contractNo?: string; reason: string }> = [];
    const restored: string[] = [];
    for (const id of uniqueIds) {
      const contract = byId.get(id);
      if (!contract) { skipped.push({ id, reason: '合同不存在' }); continue; }
      if (!contract.deletedAt) { skipped.push({ id, contractNo: contract.contractNo, reason: '合同未删除' }); continue; }
      contract.deletedAt = null;
      contract.deletedBy = null;
      contract.deletedBatchId = null;
      contract.versionNo += 1;
      contract.updatedBy = auth.userId;
      await this.contractRepo.save(contract);
      await this.recordOp(auth.userId, 'contract.batch_restore', id, 'success', {
        targetType: 'contract_batch', batchId, summaryBefore: `deleted=Y;status=${contract.status}`, summaryAfter: 'deleted=N',
      });
      restored.push(id);
    }
    if (restored.length) await this.recordOp(auth.userId, 'contract.batch_restore_summary', batchId, 'success', { targetType: 'contract_batch', batchId, summaryAfter: `restored=${restored.length};skipped=${skipped.length}` });
    return { checked: uniqueIds.length, restored, skipped };
  }

  /** 批量修改：对所选合同统一更新合同名称、起止日期和合同额。逐条返回成功/失败。 */
  async batchUpdate(auth: BizAuthContext, ids: string[], dto: UpdateContractDto): Promise<{ checked: number; updated: string[]; skipped: Array<{ id: string; contractNo?: string; reason: string }> }> {
    if (!auth.isSuperAdmin && !auth.permissionCodes.has('operation.contract.batch_update')) {
      throw new ForbiddenException('当前账号无批量修改合同权限');
    }
    const uniqueIds = [...new Set((ids ?? []).map((id) => String(id).trim()).filter(Boolean))];
    if (!uniqueIds.length) throw new BadRequestException('请至少选择一份合同');
    const contracts = await this.contractRepo.findBy({ id: In(uniqueIds) });
    const byId = new Map(contracts.map((c) => [c.id, c]));
    const skipped: Array<{ id: string; contractNo?: string; reason: string }> = [];
    const updated: string[] = [];
    for (const id of uniqueIds) {
      const contract = byId.get(id);
      if (!contract) { skipped.push({ id, reason: '合同不存在' }); continue; }
      if (contract.deletedAt) { skipped.push({ id, contractNo: contract.contractNo, reason: '已删除合同不可修改' }); continue; }
      const before = `name=${contract.contractName};start=${contract.startDate};end=${contract.endDate};amount=${contract.taxInclusiveAmountFen}`;
      try {
        if (dto.contractName !== undefined) contract.contractName = dto.contractName;
        if (dto.startDate !== undefined) contract.startDate = dto.startDate;
        if (dto.endDate !== undefined) contract.endDate = dto.endDate;
        if (dto.taxInclusiveAmountFen !== undefined) contract.taxInclusiveAmountFen = Math.round(dto.taxInclusiveAmountFen);
        if (dto.taxExclusiveAmountFen !== undefined) contract.taxExclusiveAmountFen = dto.taxExclusiveAmountFen != null ? Math.round(dto.taxExclusiveAmountFen) : null;
        contract.versionNo += 1;
        contract.updatedBy = auth.userId;
        await this.contractRepo.save(contract);
        await this.recordOp(auth.userId, 'contract.batch_update', id, 'success', {
          summaryBefore: before, summaryAfter: `name=${contract.contractName};start=${contract.startDate};end=${contract.endDate};amount=${contract.taxInclusiveAmountFen}`,
        });
        updated.push(id);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        skipped.push({ id, contractNo: contract.contractNo, reason });
        await this.recordOp(auth.userId, 'contract.batch_update', id, 'failed', { errorMessage: reason, summaryBefore: before });
      }
    }
    return { checked: uniqueIds.length, updated, skipped };
  }

  /** 导出合同：返回 CSV 字符串（含已删除由 includeDeleted 控制）。权限 operation.contract.export。 */
  async exportCsv(auth: BizAuthContext, filter: { ids?: string[]; includeDeleted?: boolean; provinceId?: string; cityId?: string; status?: string; keyword?: string }): Promise<string> {
    if (!auth.isSuperAdmin && !auth.permissionCodes.has('operation.contract.export')) {
      throw new ForbiddenException('当前账号无导出合同权限');
    }
    const contracts = await this.list(auth, {
      ...(filter.ids?.length
        ? { includeDeleted: filter.includeDeleted }
        : { provinceId: filter.provinceId, cityId: filter.cityId, status: filter.status, keyword: filter.keyword, includeDeleted: filter.includeDeleted }),
    });
    const rows = filter.ids?.length ? contracts.filter((c) => filter.ids!.includes(c.id)) : contracts;
    const header = ['合同编号', '合同名称', '含税合同额(元)', '状态', '开始日期', '结束日期', '是否删除', '创建人', '更新时间'];
    const escape = (value: unknown) => {
      const text = value == null ? '' : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const lines = [header.join(',')];
    for (const c of rows) {
      lines.push([
        c.contractNo, c.contractName, (Number(c.taxInclusiveAmountFen) / 100).toFixed(2), c.status,
        c.startDate ?? '', c.endDate ?? '', c.deletedAt ? '已删除' : '否', c.createdBy, c.updatedAt?.toISOString?.() ?? '',
      ].map(escape).join(','));
    }
    await this.recordOp(auth.userId, 'contract.export', filter.ids?.length ? filter.ids.join(',') : 'all', 'success', { targetType: 'contract_batch', summaryAfter: `count=${rows.length}` });
    return '﻿' + lines.join('\n');
  }

  // ================= 地市分配 =================

  /** 新增/调整分配：额度合计 ≤ 合同额；降低额度不得低于已生效完工金额（M5 起生效校验） */
  async upsertAllocation(auth: BizAuthContext, contractId: string, dto: AllocationDto): Promise<BizContractCityAllocationEntity> {
    const contract = await this.getContractOrFail(contractId);
    if (contract.status === ContractStatus.VOIDED) throw new BadRequestException('合同已作废');
    const city = await this.cityRepo.findOneBy({ id: dto.cityId });
    if (!city) throw new BadRequestException('地市不存在');
    if (city.provinceId !== contract.provinceId) throw new BadRequestException('地市必须属于合同所属省份');

    const contractAmount = Number(contract.taxInclusiveAmountFen) || 0;
    const quotaFen = Math.round(dto.quotaFen);
    if (quotaFen < 0) throw new BadRequestException('地市额度不能为负数');

    const others = await this.allocationRepo.findBy({ contractId, status: 'active' });
    const existing = others.find((a) => a.cityId === dto.cityId);
    const otherTotal = others.filter((a) => a.cityId !== dto.cityId).reduce((s, a) => s + Number(a.quotaFen), 0);
    if (otherTotal + quotaFen > contractAmount) {
      throw new BadRequestException('各地市额度合计不得超过合同额'); // CON-006
    }
    if (existing) {
      if (quotaFen < Number(existing.quotaFen)) {
        // M5 起：不得降低到该地市已生效完工金额以下（此处预留，完工域接入后校验）
      }
      existing.quotaFen = quotaFen;
      existing.versionNo += 1;
      await this.allocationRepo.save(existing);
      await this.recordOp(auth.userId, 'contract.allocation.update', contractId);
      return existing;
    }
    const alloc = await this.allocationRepo.save({
      id: randomUUID(), contractId, cityId: dto.cityId, quotaFen,
      status: 'active', versionNo: 1,
    });
    await this.recordOp(auth.userId, 'contract.allocation.create', contractId);
    return alloc;
  }

  /** 取消分配：仅 super_admin（allocate_cancel 权限在守卫）；历史数据保留，禁止该地市新增业务 */
  async cancelAllocation(auth: BizAuthContext, contractId: string, cityId: string): Promise<void> {
    const contract = await this.getContractOrFail(contractId);
    const alloc = await this.allocationRepo.findOneBy({ contractId, cityId, status: 'active' });
    if (!alloc) throw new NotFoundException('分配不存在');
    alloc.status = 'cancelled';
    alloc.cancelledAt = new Date();
    alloc.versionNo += 1;
    await this.allocationRepo.save(alloc);
    await this.recordOp(auth.userId, 'contract.allocation.cancel', contractId);
  }

  // ================= 费率 =================

  /** 单经营单位费率维护；0% 是无费率时的默认利润口径，可显式保存。 */
  async addFeeRate(auth: BizAuthContext, contractId: string, dto: FeeRateDto): Promise<BizContractFeeRateEntity> {
    const rates = await this.upsertFeeRates(auth, contractId, { cityIds: [dto.cityId], effectiveMonth: dto.effectiveMonth, rateBp: dto.rateBp, changeReason: dto.changeReason, overwrite: false });
    return rates[0];
  }

  async upsertFeeRates(auth: BizAuthContext, contractId: string, dto: BulkFeeRateDto): Promise<BizContractFeeRateEntity[]> {
    const contract = await this.getContractOrFail(contractId);
    await this.assertContractVisible(auth, contract);
    if (contract.status === ContractStatus.VOIDED) throw new BadRequestException('合同已作废');
    if (!/^\d{4}-\d{2}$/.test(dto.effectiveMonth)) throw new BadRequestException('生效月份格式应为 YYYY-MM');
    if (!Number.isInteger(dto.rateBp) || dto.rateBp < 0 || dto.rateBp > 10000) {
      throw new BadRequestException('管理费率必须在 0% 到 100% 之间');
    }
    const cityIds = [...new Set(dto.cityIds.map((cityId) => cityId.trim()).filter(Boolean))];
    if (cityIds.length === 0) throw new BadRequestException('请至少选择一个经营单位');
    const allocations = await this.allocationRepo.findBy({ contractId, status: 'active' });
    const allocationIds = new Set(allocations.map((allocation) => allocation.cityId));
    if (cityIds.some((cityId) => !allocationIds.has(cityId))) throw new BadRequestException('费率经营单位必须已在合同分配中');
    const existingRates = await this.feeRateRepo.findBy({ contractId, effectiveMonth: dto.effectiveMonth });
    const byCity = new Map(existingRates.map((rate) => [rate.cityId, rate]));
    if (!dto.overwrite && cityIds.some((cityId) => byCity.has(cityId))) throw new BadRequestException('存在相同经营单位和生效月份的费率，请确认覆盖后再提交');
    const saved: BizContractFeeRateEntity[] = [];
    await this.dataSource.transaction(async (manager) => {
      for (const cityId of cityIds) {
        const existing = byCity.get(cityId);
        if (existing) {
          existing.rateBp = dto.rateBp;
          existing.changeReason = dto.changeReason ?? null;
          saved.push(await manager.save(existing));
        } else {
          const rate = manager.create(BizContractFeeRateEntity, { id: randomUUID(), contractId, cityId, effectiveMonth: dto.effectiveMonth, rateBp: dto.rateBp, changeReason: dto.changeReason ?? null });
          saved.push(await manager.save(rate));
        }
      }
    });
    await this.repriceOrdersForRates(contractId, cityIds, dto.effectiveMonth);
    await this.recordOp(auth.userId, dto.overwrite ? 'contract.fee_rate.overwrite' : 'contract.fee_rate.create', contractId);
    return saved;
  }

  async copyFeeRates(auth: BizAuthContext, contractId: string, dto: CopyFeeRateDto): Promise<BizContractFeeRateEntity[]> {
    if (!/^\d{4}-\d{2}$/.test(dto.sourceMonth) || !/^\d{4}-\d{2}$/.test(dto.targetMonth)) throw new BadRequestException('费率月份格式应为 YYYY-MM');
    if (dto.sourceMonth === dto.targetMonth) throw new BadRequestException('复制来源月份和目标月份不能相同');
    const contract = await this.getContractOrFail(contractId);
    await this.assertContractVisible(auth, contract);
    if (contract.status === ContractStatus.VOIDED) throw new BadRequestException('合同已作废');
    const sourceRates = await this.feeRateRepo.findBy({ contractId, effectiveMonth: dto.sourceMonth });
    const requested = dto.cityIds?.length ? new Set(dto.cityIds) : null;
    const selected = sourceRates.filter((rate) => !requested || requested.has(rate.cityId));
    if (selected.length === 0) throw new BadRequestException('来源月份没有可复制的费率');
    const existing = await this.feeRateRepo.findBy({ contractId, effectiveMonth: dto.targetMonth });
    const byCity = new Map(existing.map((rate) => [rate.cityId, rate]));
    if (!dto.overwrite && selected.some((rate) => byCity.has(rate.cityId))) throw new BadRequestException('目标月份存在费率，请确认覆盖后再复制');
    const saved: BizContractFeeRateEntity[] = [];
    await this.dataSource.transaction(async (manager) => {
      for (const source of selected) {
        const target = byCity.get(source.cityId);
        if (target) {
          target.rateBp = source.rateBp;
          target.changeReason = `复制自 ${dto.sourceMonth}`;
          saved.push(await manager.save(target));
        } else {
          const rate = manager.create(BizContractFeeRateEntity, { id: randomUUID(), contractId, cityId: source.cityId, effectiveMonth: dto.targetMonth, rateBp: source.rateBp, changeReason: `复制自 ${dto.sourceMonth}` });
          saved.push(await manager.save(rate));
        }
      }
    });
    await this.repriceOrdersForRates(contractId, selected.map((rate) => rate.cityId), dto.targetMonth);
    await this.recordOp(auth.userId, 'contract.fee_rate.copy', contractId);
    return saved;
  }

  /**
   * 费率变更后重算订单利润快照（改为 public：费率批量维护模块复用同一逻辑，避免两套重算口径）
   * 只重算 受影响合同 + 受影响地市 + 生效月份之后 的有效订单；已作废订单不参与；
   * 待维护（needs_review）订单不参与，不改写为有效；费率缺失仍按 0 基点保持缺失语义；
   * 不修改订单原始导入金额与 34 列原始字段，只更新 feeRateSnapshotBp / grossProfitFen。
   * @returns 实际重算的订单行数
   */
  async repriceOrdersForRates(contractId: string, cityIds: string[], fromMonth: string): Promise<number> {
    if (cityIds.length === 0) return 0;
    const allRates = await this.feeRateRepo.find({ where: { contractId, cityId: In(cityIds) }, order: { effectiveMonth: 'ASC' } });
    const ratesByCity = new Map<string, BizContractFeeRateEntity[]>();
    for (const rate of allRates) ratesByCity.set(rate.cityId, [...(ratesByCity.get(rate.cityId) ?? []), rate]);
    const rows = await this.orderRowRepo.createQueryBuilder('o')
      .where('o.contract_id = :contractId', { contractId })
      .andWhere('o.city_id IN (:...cityIds)', { cityIds })
      .andWhere('o.business_month >= :fromMonth', { fromMonth })
      .andWhere('o.validation_status = :status', { status: 'valid' })
      .andWhere('o.is_void = 0')
      .andWhere('o.is_current = 1')
      .getMany();
    if (rows.length > 0) {
      await this.dataSource.transaction(async (manager) => {
        for (const row of rows) {
          const effective = (ratesByCity.get(row.cityId ?? '') ?? []).filter((rate) => rate.effectiveMonth <= (row.businessMonth ?? '')).at(-1);
          row.feeRateSnapshotBp = effective?.rateBp ?? 0;
          row.grossProfitFen = Math.round((Number(row.completionAmountFen) || 0) * row.feeRateSnapshotBp / 10000);
          await manager.save(row);
        }
      });
    }
    void this.aggregates.recalcInternal({ contractId }).catch(() => {});
    return rows.length;
  }

  /** 生效费率快照：≤ 业务月份的最大生效月份费率（订单/完工入账时调用；历史完工不回溯） */
  async getEffectiveRate(contractId: string, cityId: string, businessMonth: string): Promise<BizContractFeeRateEntity | null> {
    const rates = await this.feeRateRepo
      .createQueryBuilder('f')
      .where('f.contractId = :contractId AND f.cityId = :cityId AND f.effectiveMonth <= :month', {
        contractId, cityId, month: businessMonth,
      })
      .orderBy('f.effectiveMonth', 'DESC')
      .getMany();
    return rates[0] ?? null;
  }

  // ================= 预警 =================

  /** 合同维度财务参考（成本不关联合同：按分配地市汇总为【参考值】，一市多合同会重复计入，不用于净利润口径） */
  private async financeForContract(contract: BizContractEntity, visibleCityIds?: Set<string> | null): Promise<{ referenceCostFen: number; grossProfitFen: number; referenceNetProfitFen: number; isReference: boolean }> {
    const inScope = (cityId: string | null | undefined) => !visibleCityIds || (cityId != null && visibleCityIds.has(cityId));
    const allocations = (await this.allocationRepo.findBy({ contractId: contract.id, status: 'active' })).filter((a) => inScope(a.cityId));
    const cityIds = allocations.map((a) => a.cityId);
    let costFen = 0;
    if (cityIds.length > 0) {
      const costs = await this.costRepo.createQueryBuilder('c')
        .select('SUM(c.amountFen)', 'total')
        .where('c.status = :status', { status: 'approved' })
        .andWhere('c.cityId IN (:...cityIds)', { cityIds })
        .getRawOne();
      costFen = Number(costs?.total ?? 0);
    }
    const orders = (await this.orderRowRepo.findBy({ contractId: contract.id, isVoid: false, isCurrent: true, validationStatus: 'valid' })).filter((o) => inScope(o.cityId));
    const offlines = (await this.offlineRepo.findBy({ contractId: contract.id, status: 'approved' })).filter((o) => inScope(o.cityId));
    const grossProfitFen = orders.reduce((s, o) => s + (Number(o.grossProfitFen) || 0), 0)
      + offlines.reduce((s, o) => s + (Number(o.grossProfitFen) || 0), 0);
    return { referenceCostFen: costFen, grossProfitFen, referenceNetProfitFen: grossProfitFen - costFen, isReference: true };
  }

  /** 生成/更新合同预警（nearly_full / overfull / expiring；过期历史仅保留审计，不再显示）。 */
  async refreshAlerts(auth: BizAuthContext, contractId: string): Promise<void> {
    const contract = await this.getContractOrFail(contractId);
    const detail = await this.detail(auth, contractId);
    const tags: string[] = [];
    const progress = detail.progress.progress;
    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    if (progress >= 90 && progress < 100) tags.push(ContractTag.NEARLY_FULL);
    if (progress >= 100) {
      tags.push(ContractTag.OVERFULL);
      if (contract.status === ContractStatus.ACTIVE) tags.push(ContractTag.PENDING_COMPLETE);
    }
    if (contract.endDate) {
      const end = new Date(contract.endDate);
      const setting = await this.settingRepo.findOneBy({ settingKey: 'contract_expiry_warning_days' });
      const warningDays = Number(setting?.settingValue ?? 90);
      const thresholdMs = warningDays * 24 * 3600 * 1000;
      if (end.getTime() - now.getTime() <= thresholdMs && end.getTime() >= now.getTime() - 24 * 3600 * 1000) tags.push(ContractTag.EXPIRING);
    }
    contract.tags = tags;
    contract.updatedBy = auth.userId;
    await this.contractRepo.save(contract);
  }
}
