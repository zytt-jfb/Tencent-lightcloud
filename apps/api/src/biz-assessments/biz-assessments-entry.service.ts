import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { AssessmentRecordEntity } from './assessment-record.entity';
import { BizContractEntity } from '../contracts/biz-contract.entity';
import { BizContractCityAllocationEntity } from '../contracts/biz-contract-city-allocation.entity';
import { CityEntity } from '../main-data/city.entity';
import { BizOperationLogEntity } from '../operation-logs/biz-operation-log.entity';
import { BizAuthContext } from '../rbac/rbac.service';
import { buildDedupKey, normalizeDisplay, round2 } from './assessment-normalize';

export interface AssessmentEntryDto {
  contractId: string;
  /** YYYY-MM */
  evalMonth: string;
  supplierName: string;
  /** 0-100 */
  score: number;
  cityId?: string | null;
  evalMethod?: 'online' | 'offline';
}

export interface AssessmentEntryRow {
  id: string;
  evalMonth: string;
  projectName: string;
  cityId: string | null;
  cityName: string;
  supplierName: string;
  contractId: string | null;
  contractNo: string | null;
  score: number;
  evalMethod: 'online' | 'offline';
  status: string;
  submittedBy: string | null;
  submittedAt: Date | null;
  returnedBy: string | null;
  returnedAt: Date | null;
  returnReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 当前月份（Asia/Shanghai），用于拦截未来月份 */
function currentMonth(): string {
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  return `${year}-${month}`;
}

/**
 * 线下填报服务（工程管理 / 后评估管理）
 * 口径：
 *  - 粒度 = 合同 × 后评价月份 × 供应商，必须关联合同；项目名与合同编号由合同带出并快照
 *  - 状态流：draft → submitted；省管理员可退回（returned）后由填报人修改再提交；可作废
 *  - 只有 submitted 计入概览（draft / returned / voided 不计）
 *  - 地市账号只能填报本地市范围内合同
 */
@Injectable()
export class BizAssessmentsEntryService {
  constructor(
    @InjectRepository(AssessmentRecordEntity) private readonly recordRepo: Repository<AssessmentRecordEntity>,
    @InjectRepository(BizContractEntity) private readonly contractRepo: Repository<BizContractEntity>,
    @InjectRepository(BizContractCityAllocationEntity) private readonly allocRepo: Repository<BizContractCityAllocationEntity>,
    @InjectRepository(CityEntity) private readonly cityRepo: Repository<CityEntity>,
    @InjectRepository(BizOperationLogEntity) private readonly opLogRepo: Repository<BizOperationLogEntity>,
  ) {}

  private async recordOp(operatorId: string, actionType: string, targetId: string, resultStatus = 'success'): Promise<void> {
    await this.opLogRepo.save({
      id: randomUUID(), operatorUserId: operatorId, actionType,
      targetType: 'assessment', targetId, resultStatus,
    });
  }

  private toRow(entity: AssessmentRecordEntity): AssessmentEntryRow {
    return {
      id: entity.id,
      evalMonth: entity.evalMonth,
      projectName: entity.projectName,
      cityId: entity.cityId,
      cityName: entity.cityName,
      supplierName: entity.supplierName,
      contractId: entity.contractId,
      contractNo: entity.contractNo,
      score: Number(entity.score),
      evalMethod: entity.evalMethod,
      status: entity.status,
      submittedBy: entity.submittedBy,
      submittedAt: entity.submittedAt,
      returnedBy: entity.returnedBy,
      returnedAt: entity.returnedAt,
      returnReason: entity.returnReason,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  private scopedCityIds(auth: BizAuthContext): string[] | null {
    const scope = auth.dataScope;
    if (auth.isSuperAdmin || scope.scopeType === 'all' || scope.allowAll) return null;
    const ids = new Set<string>(scope.cityIds ?? []);
    if (scope.cityId) ids.add(scope.cityId);
    return ids.size > 0 ? [...ids] : [];
  }

  /** 校验操作人对该地市有权限：地市账号只能本地市，省级校验数据范围 */
  private async assertCityAccess(auth: BizAuthContext, cityId: string | null): Promise<void> {
    const scope = auth.dataScope;
    if (auth.isSuperAdmin || scope.scopeType === 'all' || scope.allowAll) return;
    const allowed = this.scopedCityIds(auth);
    if (allowed === null) return;
    if (allowed.length === 0) throw new ForbiddenException('当前账号无后评估数据范围');
    if (!cityId || !allowed.includes(cityId)) throw new ForbiddenException('数据范围不足：只能填报本地市的后评估');
  }

  /** 解析填报地市：地市账号强制自身地市 */
  private async resolveCity(auth: BizAuthContext, dtoCityId?: string | null): Promise<CityEntity> {
    const allowed = this.scopedCityIds(auth);
    const cityId = dtoCityId || (allowed && allowed.length === 1 ? allowed[0] : auth.cityId);
    if (!cityId) throw new BadRequestException('请选择地市');
    await this.assertCityAccess(auth, cityId);
    const city = await this.cityRepo.findOneBy({ id: cityId });
    if (!city) throw new BadRequestException('地市不存在');
    return city;
  }

  private async getOrFail(id: string): Promise<AssessmentRecordEntity> {
    const item = await this.recordRepo.findOneBy({ id });
    if (!item || item.source !== 'offline') throw new NotFoundException('线下填报记录不存在');
    return item;
  }

  /** 校验合同：存在、未作废、省份与填报地市一致；返回合同快照字段 */
  private async assertContract(contractId: string, city: CityEntity): Promise<BizContractEntity> {
    const contract = await this.contractRepo.findOneBy({ id: contractId });
    if (!contract) throw new BadRequestException('合同不存在');
    if (contract.status === 'voided') throw new BadRequestException('合同已作废，不可填报后评估');
    if (contract.provinceId !== city.provinceId) throw new BadRequestException('合同不属于该地市所在省份');
    return contract;
  }

  private assertScoreAndMonth(score: number, evalMonth: string): void {
    // 与导入口径一致：允许加分项，上限 150
    if (!Number.isFinite(score) || score < 0 || score > 150) throw new BadRequestException('后评价分数必须在 0-150 之间');
    if (!/^\d{4}-\d{2}$/.test(evalMonth)) throw new BadRequestException('后评价月份格式应为 YYYY-MM');
    if (evalMonth > currentMonth()) throw new BadRequestException('后评价月份不能是未来月份');
  }

  // ==================== 查询 ====================

  async list(auth: BizAuthContext, filter: { months?: string[]; status?: string; cityIds?: string[]; supplierName?: string; contractNo?: string }): Promise<AssessmentEntryRow[]> {
    const qb = this.recordRepo.createQueryBuilder('r')
      .where('r.source = :source', { source: 'offline' });
    const scopeIds = this.scopedCityIds(auth);
    if (scopeIds !== null) {
      if (scopeIds.length === 0) return [];
      qb.andWhere('r.cityId IN (:...scopeIds)', { scopeIds });
    }
    if (filter.status) qb.andWhere('r.status = :status', { status: filter.status });
    if (filter.months?.length) qb.andWhere('r.evalMonth IN (:...months)', { months: filter.months });
    if (filter.cityIds?.length) qb.andWhere('r.cityId IN (:...filterCityIds)', { filterCityIds: filter.cityIds });
    if (filter.supplierName?.trim()) qb.andWhere('r.supplierName LIKE :supplierLike', { supplierLike: `%${filter.supplierName.trim()}%` });
    if (filter.contractNo?.trim()) qb.andWhere('r.contractNo LIKE :contractLike', { contractLike: `%${filter.contractNo.trim()}%` });
    const items = await qb.orderBy('r.evalMonth', 'DESC').addOrderBy('r.updatedAt', 'DESC').take(1000).getMany();
    return items.map((item) => this.toRow(item));
  }

  // ==================== 新增 / 编辑 ====================

  async create(auth: BizAuthContext, dto: AssessmentEntryDto): Promise<AssessmentEntryRow> {
    const city = await this.resolveCity(auth, dto.cityId);
    const score = round2(Number(dto.score));
    this.assertScoreAndMonth(score, dto.evalMonth);
    const supplierName = normalizeDisplay(dto.supplierName);
    if (!supplierName) throw new BadRequestException('供应商不能为空');
    const contract = await this.assertContract(dto.contractId, city);

    const dedupKey = buildDedupKey(['offline', dto.evalMonth, contract.id, supplierName]);
    const existing = await this.recordRepo.findOneBy({ dedupKey });
    if (existing) {
      throw new BadRequestException(`同一合同、月份、供应商已有填报记录（${existing.evalMonth} ${existing.supplierName}），请直接编辑该记录`);
    }

    const item = await this.recordRepo.save({
      id: randomUUID(),
      source: 'offline',
      batchId: null,
      evalMonth: dto.evalMonth,
      projectName: contract.contractName,
      cityId: city.id,
      cityName: city.name,
      provinceId: city.provinceId,
      supplierName,
      contractId: contract.id,
      contractNo: contract.contractNo,
      score,
      grade: null,
      evalMethod: dto.evalMethod === 'online' ? 'online' : 'offline',
      srcSeq: null,
      rawJson: null,
      status: 'draft',
      dedupKey,
      submittedBy: null,
      submittedAt: null,
      returnedBy: null,
      returnedAt: null,
      returnReason: null,
      voidedBy: null,
      voidedAt: null,
      voidReason: null,
      createdBy: auth.userId,
      updatedBy: auth.userId,
    } as AssessmentRecordEntity);
    await this.recordOp(auth.userId, 'assessment.entry.create', item.id);
    return this.toRow(item);
  }

  async update(auth: BizAuthContext, id: string, dto: Partial<AssessmentEntryDto>): Promise<AssessmentEntryRow> {
    const item = await this.getOrFail(id);
    await this.assertCityAccess(auth, item.cityId);
    if (!['draft', 'returned'].includes(item.status)) throw new BadRequestException('仅草稿或已退回的记录可编辑');

    const city = dto.cityId && dto.cityId !== item.cityId ? await this.resolveCity(auth, dto.cityId) : { id: item.cityId ?? '', provinceId: item.provinceId ?? '', name: item.cityName } as CityEntity;
    const evalMonth = dto.evalMonth ?? item.evalMonth;
    const score = round2(Number(dto.score ?? item.score));
    this.assertScoreAndMonth(score, evalMonth);
    const supplierName = dto.supplierName === undefined ? item.supplierName : normalizeDisplay(dto.supplierName);
    if (!supplierName) throw new BadRequestException('供应商不能为空');
    const contractId = dto.contractId ?? item.contractId;
    if (!contractId) throw new BadRequestException('必须关联合同');
    const contract = await this.assertContract(contractId, city);

    const dedupKey = buildDedupKey(['offline', evalMonth, contract.id, supplierName]);
    const duplicated = await this.recordRepo.findOneBy({ dedupKey });
    if (duplicated && duplicated.id !== item.id) {
      throw new BadRequestException('同一合同、月份、供应商已有另一条填报记录');
    }

    Object.assign(item, {
      evalMonth,
      projectName: contract.contractName,
      cityId: city.id || item.cityId,
      cityName: city.name || item.cityName,
      provinceId: city.provinceId || item.provinceId,
      supplierName,
      contractId: contract.id,
      contractNo: contract.contractNo,
      score,
      evalMethod: dto.evalMethod === 'online' ? 'online' : dto.evalMethod === 'offline' ? 'offline' : item.evalMethod,
      dedupKey,
      updatedBy: auth.userId,
    });
    await this.recordRepo.save(item);
    await this.recordOp(auth.userId, 'assessment.entry.update', id);
    return this.toRow(item);
  }

  // ==================== 状态流转 ====================

  async submit(auth: BizAuthContext, id: string): Promise<AssessmentEntryRow> {
    const item = await this.getOrFail(id);
    await this.assertCityAccess(auth, item.cityId);
    if (!['draft', 'returned'].includes(item.status)) throw new BadRequestException('仅草稿或已退回的记录可提交');
    if (!item.contractId) throw new BadRequestException('必须关联合同后才能提交');
    this.assertScoreAndMonth(Number(item.score), item.evalMonth);
    item.status = 'submitted';
    item.submittedBy = auth.userId;
    item.submittedAt = new Date();
    item.updatedBy = auth.userId;
    await this.recordRepo.save(item);
    await this.recordOp(auth.userId, 'assessment.entry.submit', id);
    return this.toRow(item);
  }

  /** 撤回提交：提交人本人或超级管理员 */
  async withdraw(auth: BizAuthContext, id: string): Promise<AssessmentEntryRow> {
    const item = await this.getOrFail(id);
    await this.assertCityAccess(auth, item.cityId);
    if (item.status !== 'submitted') throw new BadRequestException('仅已提交的记录可撤回');
    if (!auth.isSuperAdmin && item.submittedBy !== auth.userId) throw new ForbiddenException('仅提交人可撤回');
    item.status = 'draft';
    item.submittedBy = null;
    item.submittedAt = null;
    item.updatedBy = auth.userId;
    await this.recordRepo.save(item);
    await this.recordOp(auth.userId, 'assessment.entry.withdraw', id);
    return this.toRow(item);
  }

  /** 退回：省管理员操作，原因必填 */
  async returnEntry(auth: BizAuthContext, id: string, reason: string): Promise<AssessmentEntryRow> {
    const item = await this.getOrFail(id);
    if (item.status !== 'submitted') throw new BadRequestException('仅已提交的记录可退回');
    if (!reason?.trim()) throw new BadRequestException('退回原因必填');
    item.status = 'returned';
    item.returnedBy = auth.userId;
    item.returnedAt = new Date();
    item.returnReason = reason.trim().slice(0, 500);
    item.updatedBy = auth.userId;
    await this.recordRepo.save(item);
    await this.recordOp(auth.userId, 'assessment.entry.return', id);
    return this.toRow(item);
  }

  /** 作废：省管理员操作，原因必填；作废后不计入概览 */
  async voidEntry(auth: BizAuthContext, id: string, reason: string): Promise<AssessmentEntryRow> {
    const item = await this.getOrFail(id);
    if (!reason?.trim()) throw new BadRequestException('作废原因必填');
    if (item.status === 'voided') throw new BadRequestException('记录已作废');
    item.status = 'voided';
    item.voidedBy = auth.userId;
    item.voidedAt = new Date();
    item.voidReason = reason.trim().slice(0, 255);
    item.updatedBy = auth.userId;
    await this.recordRepo.save(item);
    await this.recordOp(auth.userId, 'assessment.entry.void', id);
    return this.toRow(item);
  }

  /** 删除：仅草稿可删，物理删除（草稿从未计入统计） */
  async remove(auth: BizAuthContext, id: string): Promise<{ ok: true }> {
    const item = await this.getOrFail(id);
    await this.assertCityAccess(auth, item.cityId);
    if (item.status !== 'draft') throw new BadRequestException('仅草稿可删除，已提交记录请作废');
    await this.recordRepo.delete({ id });
    await this.recordOp(auth.userId, 'assessment.entry.delete', id);
    return { ok: true };
  }

  /** 填报页合同下拉：按数据范围过滤，只返回未作废合同 */
  async contractOptions(auth: BizAuthContext, keyword?: string): Promise<Array<{ id: string; contractNo: string; contractName: string; provinceId: string }>> {
    const scope = auth.dataScope;
    const qb = this.contractRepo.createQueryBuilder('c')
      .select(['c.id', 'c.contractNo', 'c.contractName', 'c.provinceId'])
      .where('c.status <> :voided', { voided: 'voided' });
    if (!auth.isSuperAdmin && scope.scopeType !== 'all' && !scope.allowAll && scope.provinceIds.length > 0) {
      qb.andWhere('c.provinceId IN (:...provinceIds)', { provinceIds: scope.provinceIds });
    }
    if (keyword?.trim()) {
      const like = `%${keyword.trim()}%`;
      qb.andWhere('(c.contractNo LIKE :like OR c.contractName LIKE :like)', { like });
    }
    const items = await qb.orderBy('c.contractNo', 'ASC').take(50).getMany();
    return items.map((item) => ({ id: item.id, contractNo: item.contractNo, contractName: item.contractName, provinceId: item.provinceId }));
  }

  /**
   * 填报地市候选：优先取合同的生效分配地市；合同没有分配记录时回退到合同所在省份的全部地市。
   * 结果再按操作人数据范围过滤，保证地市账号只看到自己的地市。
   */
  async cityOptions(auth: BizAuthContext, contractId: string): Promise<Array<{ id: string; name: string }>> {
    if (!contractId?.trim()) return [];
    const contract = await this.contractRepo.findOneBy({ id: contractId });
    if (!contract) throw new BadRequestException('合同不存在');
    const allocations = await this.allocRepo.find({ where: { contractId, status: 'active' } });
    const cities = allocations.length > 0
      ? await this.cityRepo.find({ where: { id: In(allocations.map((item) => item.cityId)) } })
      : await this.cityRepo.find({ where: { provinceId: contract.provinceId } });
    const allowed = this.scopedCityIds(auth);
    const visible = allowed === null ? cities : cities.filter((city) => allowed.includes(city.id));
    return visible
      .map((city) => ({ id: city.id, name: city.name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  }
}
