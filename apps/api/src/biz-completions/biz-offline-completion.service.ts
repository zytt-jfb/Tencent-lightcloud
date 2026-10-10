import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { OfflineCompletionStatus, PlatformRole } from '@biz-reporting/shared-types';
import { BizOfflineCompletionEntity } from '../completions/biz-offline-completion.entity';
import { BizContractEntity } from '../contracts/biz-contract.entity';
import { BizContractCityAllocationEntity } from '../contracts/biz-contract-city-allocation.entity';
import { BizOperationLogEntity } from '../operation-logs/biz-operation-log.entity';
import { BizContractFeeRateEntity } from '../contracts/biz-contract-fee-rate.entity';
import { RbacService, BizAuthContext } from '../rbac/rbac.service';
import { BizAggregateService } from '../biz-aggregates/biz-aggregate.service';
import { CityEntity } from '../main-data/city.entity';

export interface OfflineCompletionDto {
  contractId: string;
  cityId: string;
  businessMonth: string; // YYYY-MM
  amountFen: number;
  summary: string;
  attachmentRef?: string | null;
}

/**
 * 线下完工服务（新基线 M5）
 * 基线：01 §6 / 02 TABLE 4 / 04 §5 ——
 *  - 地市用户仅本地市范围（cityId 强制绑定地市）；
 *  - 提交校验：金额 >0、业务月份不得未来、合同已分配本地市；
 *  - 审核通过/驳回：super_admin/admin，重新校验合同状态与分配关系，乐观锁并发；
 *  - 已通过记录受权作废/恢复（原因必填、操作日志、退出/恢复统计）；
 *  - 版本并发：@VersionColumn 乐观锁（version_no+1 且 WHERE version_no 匹配）。
 */
@Injectable()
export class BizOfflineCompletionService {
  constructor(
    @InjectRepository(BizOfflineCompletionEntity)
    private readonly offlineRepo: Repository<BizOfflineCompletionEntity>,
    @InjectRepository(BizContractEntity)
    private readonly contractRepo: Repository<BizContractEntity>,
    @InjectRepository(BizContractCityAllocationEntity)
    private readonly allocRepo: Repository<BizContractCityAllocationEntity>,
    @InjectRepository(BizOperationLogEntity)
    private readonly opLogRepo: Repository<BizOperationLogEntity>,
    @InjectRepository(CityEntity)
    private readonly cityRepo: Repository<CityEntity>,
    @InjectRepository(BizContractFeeRateEntity)
    private readonly feeRateRepo: Repository<BizContractFeeRateEntity>,
    private readonly rbac: RbacService,
    private readonly aggregates: BizAggregateService,
  ) {}

  private async recordOp(operatorId: string, actionType: string, targetId: string, resultStatus = 'success'): Promise<void> {
    await this.opLogRepo.save({
      id: randomUUID(), operatorUserId: operatorId, actionType,
      targetType: 'offline_completion', targetId, resultStatus,
    });
  }

  private async getOrFail(id: string): Promise<BizOfflineCompletionEntity> {
    const item = await this.offlineRepo.findOneBy({ id });
    if (!item) throw new NotFoundException('线下完工记录不存在');
    return item;
  }

  /** 地市用户仅其数据范围内的地市（支持多城市）；admin 校验地市数据范围 */
  private async assertCityAccess(auth: BizAuthContext, cityId: string | null): Promise<void> {
    if (auth.dataScope.scopeType === 'contract') throw new ForbiddenException('当前账号无完工数据范围');
    const allowedCityIds = auth.dataScope.cityIds?.length
      ? auth.dataScope.cityIds
      : auth.dataScope.cityId ? [auth.dataScope.cityId] : [];
    if (auth.roleCode === PlatformRole.CITY_USER) {
      if (!cityId || !allowedCityIds.includes(cityId)) throw new ForbiddenException('数据范围不足');
    } else if (cityId) {
      await this.rbac.assertCityScope(auth, cityId);
    }
  }

  // ================= 列表/详情 =================

  async list(auth: BizAuthContext, filter: { cityId?: string; status?: string }): Promise<Array<BizOfflineCompletionEntity & { cityName: string }>> {
    if (filter.cityId) await this.assertCityAccess(auth, filter.cityId);
    const qb = this.offlineRepo.createQueryBuilder('o');
    if (auth.dataScope.scopeType === 'contract') throw new ForbiddenException('当前账号无完工数据范围');
    if (auth.dataScope.cityIds?.length) {
      qb.andWhere('o.cityId IN (:...scopeCityIds)', { scopeCityIds: auth.dataScope.cityIds });
    } else if (auth.dataScope.scopeType === 'city') {
      qb.andWhere('o.cityId = :scopeCityId', { scopeCityId: auth.dataScope.cityId });
    }
    if (auth.dataScope.scopeType === 'province' && auth.dataScope.provinceIds.length > 0) {
      const cities = await this.cityRepo.find({ where: { provinceId: In(auth.dataScope.provinceIds) } });
      const cityIds = cities.map((city) => city.id);
      if (cityIds.length === 0) qb.andWhere('1 = 0');
      else qb.andWhere('o.cityId IN (:...scopeCityIds)', { scopeCityIds: cityIds });
    }
    if (filter.cityId) qb.andWhere('o.cityId = :cityId', { cityId: filter.cityId });
    if (filter.status) qb.andWhere('o.status = :status', { status: filter.status });
    const items = await qb.orderBy('o.createdAt', 'DESC').getMany();
    const cityIds = [...new Set(items.map((item) => item.cityId).filter(Boolean))];
    const cities = cityIds.length > 0 ? await this.cityRepo.find({ where: { id: In(cityIds) } }) : [];
    const cityNames = new Map(cities.map((city) => [city.id, city.name]));
    return items.map((item) => ({ ...item, cityName: cityNames.get(item.cityId) ?? item.cityId }));
  }

  async detail(auth: BizAuthContext, id: string): Promise<BizOfflineCompletionEntity> {
    const item = await this.getOrFail(id);
    await this.assertCityAccess(auth, item.cityId);
    return item;
  }

  // ================= 新增/编辑/撤回 =================

  async create(auth: BizAuthContext, dto: OfflineCompletionDto): Promise<BizOfflineCompletionEntity> {
    await this.assertCityAccess(auth, dto.cityId);
    await this.assertSubmissionRules(dto);
    const item = await this.offlineRepo.save({
      id: randomUUID(),
      contractId: dto.contractId,
      cityId: dto.cityId,
      businessMonth: dto.businessMonth,
      amountFen: Math.round(dto.amountFen),
      summary: dto.summary,
      attachmentRef: dto.attachmentRef ?? null,
      status: OfflineCompletionStatus.DRAFT,
      cityOverrunFlag: false,
      contractOverrunFlag: false,
      versionNo: 1,
    });
    await this.recordOp(auth.userId, 'offline_completion.create', item.id);
    return item;
  }

  async update(auth: BizAuthContext, id: string, dto: Partial<OfflineCompletionDto>): Promise<BizOfflineCompletionEntity> {
    const item = await this.getOrFail(id);
    await this.assertCityAccess(auth, item.cityId);
    if (item.status !== OfflineCompletionStatus.DRAFT && item.status !== OfflineCompletionStatus.REJECTED) {
      throw new BadRequestException('仅草稿或已驳回记录可编辑');
    }
    const merged: OfflineCompletionDto = {
      contractId: dto.contractId ?? item.contractId,
      cityId: dto.cityId ?? item.cityId,
      businessMonth: dto.businessMonth ?? item.businessMonth,
      amountFen: dto.amountFen ?? Number(item.amountFen),
      summary: dto.summary ?? item.summary,
      attachmentRef: dto.attachmentRef ?? item.attachmentRef,
    };
    await this.assertSubmissionRules(merged);
    // 新 cityId 范围校验（update 允许改城市时，新城市必须在操作人数据范围内）
    if (merged.cityId !== item.cityId) await this.assertCityAccess(auth, merged.cityId);
    await this.applyRateSnapshot({ ...item, contractId: merged.contractId, cityId: merged.cityId, businessMonth: merged.businessMonth, amountFen: Math.round(merged.amountFen) } as BizOfflineCompletionEntity);
    Object.assign(item, {
      contractId: merged.contractId,
      cityId: merged.cityId,
      businessMonth: merged.businessMonth,
      amountFen: Math.round(merged.amountFen),
      summary: merged.summary,
      attachmentRef: merged.attachmentRef,
    });
    await this.offlineRepo.save(item); // 乐观锁
    await this.recordOp(auth.userId, 'offline_completion.update', id);
    return item;
  }

  /** 提交审核：金额>0、月份非未来、合同已分配本地市、合同未作废 */
  async submit(auth: BizAuthContext, id: string): Promise<BizOfflineCompletionEntity> {
    const item = await this.getOrFail(id);
    await this.assertCityAccess(auth, item.cityId);
    if (item.status !== OfflineCompletionStatus.DRAFT && item.status !== OfflineCompletionStatus.REJECTED) {
      throw new BadRequestException('仅草稿或已驳回记录可提交');
    }
    await this.assertSubmissionRules({
      contractId: item.contractId, cityId: item.cityId, businessMonth: item.businessMonth,
      amountFen: Number(item.amountFen), summary: item.summary, attachmentRef: item.attachmentRef,
    });
    // 费率快照：按 合同+地市+业务月份 取最新生效费率，固化到记录并计算毛利（指标字典 MET-003）
    await this.applyRateSnapshot(item);
    item.status = OfflineCompletionStatus.PENDING;
    item.submittedBy = auth.userId;
    item.submittedAt = new Date();
    item.reviewerId = null;
    item.reviewedAt = null;
    item.reviewComment = null;
    await this.offlineRepo.save(item);
    await this.recordOp(auth.userId, 'offline_completion.submit', id);
    return item;
  }

  /** 撤回已提交（仅提交人自己，super_admin 可代撤） */
  async withdraw(auth: BizAuthContext, id: string): Promise<BizOfflineCompletionEntity> {
    const item = await this.getOrFail(id);
    await this.assertCityAccess(auth, item.cityId);
    if (item.status !== OfflineCompletionStatus.PENDING) throw new BadRequestException('仅已提交记录可撤回');
    if (!auth.isSuperAdmin && item.submittedBy !== auth.userId) throw new ForbiddenException('仅提交人可撤回');
    item.status = OfflineCompletionStatus.DRAFT;
    item.submittedBy = null;
    item.submittedAt = null;
    await this.offlineRepo.save(item);
    await this.recordOp(auth.userId, 'offline_completion.withdraw', id);
    return item;
  }

  /** 费率快照：管理费率按 合同+地市+业务月份 取 ≤month 最新生效值；毛利 = 金额 × 费率 / 10000 */
  private async applyRateSnapshot(item: BizOfflineCompletionEntity): Promise<void> {
    const rate = await this.feeRateRepo.createQueryBuilder('f')
      .where('f.contractId = :contractId AND f.cityId = :cityId AND f.effectiveMonth <= :month', {
        contractId: item.contractId, cityId: item.cityId, month: item.businessMonth,
      })
      .orderBy('f.effectiveMonth', 'DESC')
      .getOne();
    item.feeRateSnapshotBp = rate ? rate.rateBp : 0;
    item.grossProfitFen = Math.round((Number(item.amountFen) * (rate ? rate.rateBp : 0)) / 10000);
  }

  /** 提交校验（DEV-039）：金额>0、月份非未来、合同已分配本地市 */
  private async assertSubmissionRules(dto: OfflineCompletionDto): Promise<void> {
    if (!Number.isFinite(dto.amountFen) || dto.amountFen <= 0) throw new BadRequestException('线下完工金额必须大于 0');
    if (!/^\d{4}-\d{2}$/.test(dto.businessMonth)) throw new BadRequestException('业务月份格式应为 YYYY-MM');
    const [year, month] = dto.businessMonth.split('-').map(Number);
    const now = new Date();
    const currentMonth = now.getFullYear() * 12 + now.getMonth() + 1;
    const targetMonth = year * 12 + month;
    if (targetMonth > currentMonth) throw new BadRequestException('业务月份不能是未来月份');
    const contract = await this.contractRepo.findOneBy({ id: dto.contractId });
    if (!contract) throw new BadRequestException('合同不存在');
    if (contract.status === 'voided') throw new BadRequestException('合同已作废，不可填报完工');
    const alloc = await this.allocRepo.findOneBy({ contractId: dto.contractId, cityId: dto.cityId, status: 'active' });
    if (!alloc) throw new BadRequestException('合同未分配给该地市，不可填报完工');
  }

  // ================= 审核（DEV-040） =================

  /** 审核通过：重新校验合同状态与分配；乐观锁防并发 */
  async approve(auth: BizAuthContext, id: string): Promise<BizOfflineCompletionEntity> {
    const item = await this.getOrFail(id);
    await this.assertCityAccess(auth, item.cityId);
    if (item.status !== OfflineCompletionStatus.PENDING) throw new BadRequestException('仅已提交记录可审核');
    await this.assertSubmissionRules({
      contractId: item.contractId, cityId: item.cityId, businessMonth: item.businessMonth,
      amountFen: Number(item.amountFen), summary: item.summary, attachmentRef: item.attachmentRef,
    });
    item.status = OfflineCompletionStatus.APPROVED;
    item.reviewerId = auth.userId;
    item.reviewedAt = new Date();
    item.reviewComment = null;
    try {
      await this.offlineRepo.save(item); // 乐观锁：并发修改抛 OptimisticLockVersionMismatchError
    } catch (error) {
      if (error instanceof Error && error.name === 'OptimisticLockVersionMismatchError') {
        throw new BadRequestException('记录已被他人修改，请刷新后重试');
      }
      throw error;
    }
    await this.recordOp(auth.userId, 'offline_completion.approve', id);
    void this.aggregates.recalcInternal({ contractId: item.contractId }).catch(() => {});
    return item;
  }

  /** 驳回：原因必填；退回草稿可修改重新提交 */
  async reject(auth: BizAuthContext, id: string, comment: string): Promise<BizOfflineCompletionEntity> {
    const item = await this.getOrFail(id);
    await this.assertCityAccess(auth, item.cityId);
    if (item.status !== OfflineCompletionStatus.PENDING) throw new BadRequestException('仅已提交记录可驳回');
    if (!comment?.trim()) throw new BadRequestException('驳回原因必填');
    item.status = OfflineCompletionStatus.REJECTED;
    item.reviewerId = auth.userId;
    item.reviewedAt = new Date();
    item.reviewComment = comment.trim().slice(0, 500);
    await this.offlineRepo.save(item);
    await this.recordOp(auth.userId, 'offline_completion.reject', id);
    return item;
  }

  // ================= 作废/恢复（DEV-041） =================

  /** 已通过记录作废：仅授权（approve 权限）可操作；原因必填；退出统计 */
  async voidItem(auth: BizAuthContext, id: string, reason: string): Promise<BizOfflineCompletionEntity> {
    const item = await this.getOrFail(id);
    await this.assertCityAccess(auth, item.cityId);
    if (item.status !== OfflineCompletionStatus.APPROVED) throw new BadRequestException('仅已审核通过的记录可作废');
    if (!reason?.trim()) throw new BadRequestException('作废原因必填');
    item.status = OfflineCompletionStatus.VOIDED;
    item.voidedBy = auth.userId;
    item.voidedAt = new Date();
    item.voidReason = reason.trim().slice(0, 255);
    await this.offlineRepo.save(item);
    await this.recordOp(auth.userId, 'offline_completion.void', id);
    void this.aggregates.recalcInternal({ contractId: item.contractId }).catch(() => {});
    return item;
  }

  /** 恢复已作废记录：仅授权（approve 权限）可操作 */
  async restoreItem(auth: BizAuthContext, id: string): Promise<BizOfflineCompletionEntity> {
    const item = await this.getOrFail(id);
    await this.assertCityAccess(auth, item.cityId);
    if (item.status !== OfflineCompletionStatus.VOIDED) throw new BadRequestException('仅已作废记录可恢复');
    item.status = OfflineCompletionStatus.APPROVED;
    item.voidedBy = null;
    item.voidedAt = null;
    item.voidReason = null;
    await this.offlineRepo.save(item);
    await this.recordOp(auth.userId, 'offline_completion.restore', id);
    void this.aggregates.recalcInternal({ contractId: item.contractId }).catch(() => {});
    return item;
  }
}
