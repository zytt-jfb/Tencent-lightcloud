import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { DataSource, EntityManager, Repository } from 'typeorm';
import type {
  CostFactItem,
  FactPage,
  FactVersionItem,
  FactVersionQuery,
  OrderFactItem,
  ReverseFactRequest,
  UpdateCostFactRequest,
  UpdateOrderFactRequest,
} from '@biz-reporting/shared-types';
import { CityEntity } from '../cities/city.entity';
import { OperationLogEntity } from '../common/entities/operation-log.entity';
import { AllocationEntity } from '../contracts/allocation.entity';
import { ContractEntity } from '../contracts/contract.entity';
import { CostFactEntity } from './cost-fact.entity';
import { FactVersionEntity } from './fact-version.entity';
import type { FactActor } from './facts.service';
import { OrderFactEntity } from './order-fact.entity';

type FactEntity = CostFactEntity | OrderFactEntity;

@Injectable()
export class FactLifecycleService {
  constructor(
    @InjectRepository(CostFactEntity) private readonly costRepo: Repository<CostFactEntity>,
    @InjectRepository(OrderFactEntity) private readonly orderRepo: Repository<OrderFactEntity>,
    @InjectRepository(FactVersionEntity) private readonly versionRepo: Repository<FactVersionEntity>,
    @InjectRepository(ContractEntity) private readonly contractRepo: Repository<ContractEntity>,
    @InjectRepository(AllocationEntity) private readonly allocationRepo: Repository<AllocationEntity>,
    @InjectRepository(CityEntity) private readonly cityRepo: Repository<CityEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async updateCost(id: number, dto: UpdateCostFactRequest, actor: FactActor): Promise<CostFactItem> {
    const cityId = this.requireCity(actor);
    this.assertMutation(dto.reason, dto.expectedVersionNo);
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(CostFactEntity);
      const current = await repo.findOne({ where: { id, cityId } });
      if (!current) throw new NotFoundException('成本记录不存在');
      if (current.isReversed) throw new ConflictException('已撤销的成本记录不能继续编辑');
      this.assertExpected(current, dto.expectedVersionNo);
      const before = { ...current };
      if (dto.contractId !== undefined) {
        await this.assertAllocated(manager, cityId, dto.contractId);
        current.contractId = dto.contractId;
      }
      if (dto.occurredOn !== undefined) {
        const date = this.requireDate(dto.occurredOn, '发生日期');
        current.occurredOn = dto.occurredOn;
        current.periodYear = date.getFullYear();
        current.periodMonth = date.getMonth() + 1;
      }
      if (dto.costCategoryCode !== undefined) current.costCategoryCode = this.requiredText(dto.costCategoryCode, '成本类别');
      if (dto.costSubtype !== undefined) current.costSubtype = this.nullText(dto.costSubtype);
      if (dto.description !== undefined) current.description = this.requiredText(dto.description, '事由');
      if (dto.amount !== undefined) current.amount = this.requireAmount(dto.amount, false);
      if (dto.actualSpender !== undefined) current.actualSpender = this.nullText(dto.actualSpender);
      if (dto.advancePayer !== undefined) current.advancePayer = this.nullText(dto.advancePayer);
      if (dto.receiptType !== undefined) current.receiptType = this.nullText(dto.receiptType);
      if (dto.approvalNumber !== undefined) current.approvalNumber = this.nullText(dto.approvalNumber);
      if (dto.approvalStatus !== undefined) current.approvalStatus = this.nullText(dto.approvalStatus);
      current.versionNo = dto.expectedVersionNo + 1;
      current.updatedBy = actor.userId;
      current.updatedAt = new Date();
      await this.casSave(repo, current, dto.expectedVersionNo, actor);
      await this.writeVersion(manager, 'cost', current, before, 'update', dto.reason, actor, 'manual');
      return this.costItem(current);
    });
  }

  async updateOrder(id: number, dto: UpdateOrderFactRequest, actor: FactActor): Promise<OrderFactItem> {
    const cityId = this.requireCity(actor);
    this.assertMutation(dto.reason, dto.expectedVersionNo);
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(OrderFactEntity);
      const current = await repo.findOne({ where: { id, cityId } });
      if (!current) throw new NotFoundException('订单记录不存在');
      if (current.isReversed) throw new ConflictException('已撤销的订单记录不能继续编辑');
      this.assertExpected(current, dto.expectedVersionNo);
      const before = { ...current };
      if (dto.contractId !== undefined) {
        await this.assertAllocated(manager, cityId, dto.contractId);
        current.contractId = dto.contractId;
      }
      if (dto.purchaseOrderNo !== undefined) current.purchaseOrderNo = this.requiredText(dto.purchaseOrderNo, '采购订单编号');
      if (dto.orderStatus !== undefined) current.orderStatus = this.requiredText(dto.orderStatus, '订单状态');
      if (dto.taxInclusiveAmount !== undefined) current.taxInclusiveAmount = this.requireAmount(dto.taxInclusiveAmount, true);
      if (dto.materialName !== undefined) current.materialName = this.requiredText(dto.materialName, '物料名称');
      if (dto.materialCode !== undefined) current.materialCode = this.requiredText(dto.materialCode, '物料编码');
      if (dto.projectCode !== undefined) current.projectCode = this.nullText(dto.projectCode);
      if (dto.projectName !== undefined) current.projectName = this.nullText(dto.projectName);
      if (dto.siteCode !== undefined) current.siteCode = this.nullText(dto.siteCode);
      if (dto.siteName !== undefined) current.siteName = this.nullText(dto.siteName);
      if (dto.receiptStatus !== undefined) current.receiptStatus = this.nullText(dto.receiptStatus);
      if (dto.orderedAt !== undefined) {
        const date = this.requireDate(dto.orderedAt, '下单时间');
        current.orderedAt = date;
        current.periodYear = date.getFullYear();
        current.periodMonth = date.getMonth() + 1;
      }
      current.businessKey = this.orderKey(current);
      current.isReversal = Number(current.taxInclusiveAmount) < 0 ? 1 : 0;
      current.versionNo = dto.expectedVersionNo + 1;
      current.updatedBy = actor.userId;
      current.updatedAt = new Date();
      const duplicate = await repo.findOne({ where: { cityId, businessKey: current.businessKey } });
      if (duplicate && duplicate.id !== id) throw new ConflictException('行级业务键冲突');
      await this.casSave(repo, current, dto.expectedVersionNo, actor);
      await this.writeVersion(manager, 'order', current, before, 'update', dto.reason, actor, 'manual');
      return this.orderItem(current);
    });
  }

  reverseCost(id: number, dto: ReverseFactRequest, actor: FactActor): Promise<CostFactItem> {
    return this.dataSource.transaction(async (manager) => {
      const cityId = this.requireCity(actor);
      this.assertMutation(dto.reason, dto.expectedVersionNo);
      const repo = manager.getRepository(CostFactEntity);
      const current = await repo.findOne({ where: { id, cityId } });
      if (!current) throw new NotFoundException('成本记录不存在');
      if (current.isReversed) throw new ConflictException('该成本记录已撤销');
      this.assertExpected(current, dto.expectedVersionNo);
      const before = { ...current };
      current.isReversed = 1;
      current.versionNo = dto.expectedVersionNo + 1;
      current.updatedBy = actor.userId;
      current.updatedAt = new Date();
      await this.casSave(repo, current, dto.expectedVersionNo, actor);
      await this.writeVersion(manager, 'cost', current, before, 'reverse', dto.reason, actor, 'reversal');
      const reversal = await repo.save(repo.create({
        ...current, id: undefined, amount: -Number(current.amount), sourceType: 'reversal', importBatchId: null,
        sourceRowId: null, reversedFactId: current.id, isReversed: 0, versionNo: 1,
        createdBy: actor.userId, updatedBy: actor.userId, createdAt: undefined, updatedAt: undefined,
      }));
      await this.writeVersion(manager, 'cost', reversal, null, 'create', `冲销：${dto.reason}`, actor, 'reversal');
      return this.costItem(reversal);
    });
  }

  reverseOrder(id: number, dto: ReverseFactRequest, actor: FactActor): Promise<OrderFactItem> {
    return this.dataSource.transaction(async (manager) => {
      const cityId = this.requireCity(actor);
      this.assertMutation(dto.reason, dto.expectedVersionNo);
      const repo = manager.getRepository(OrderFactEntity);
      const current = await repo.findOne({ where: { id, cityId } });
      if (!current) throw new NotFoundException('订单记录不存在');
      if (current.isReversed) throw new ConflictException('该订单记录已撤销');
      this.assertExpected(current, dto.expectedVersionNo);
      const before = { ...current };
      current.isReversed = 1;
      current.versionNo = dto.expectedVersionNo + 1;
      current.updatedBy = actor.userId;
      current.updatedAt = new Date();
      await this.casSave(repo, current, dto.expectedVersionNo, actor);
      await this.writeVersion(manager, 'order', current, before, 'reverse', dto.reason, actor, 'reversal');
      const reversalData = {
        ...current,
        purchaseOrderNo: `${current.purchaseOrderNo}-冲销-${Date.now()}`,
        taxInclusiveAmount: -Number(current.taxInclusiveAmount),
      };
      const reversal = await repo.save(repo.create({
        ...reversalData, id: undefined, businessKey: this.orderKey(reversalData), sourceType: 'reversal', importBatchId: null,
        sourceRowId: null, isReversal: 1, isReversed: 0, reversedFactId: current.id, versionNo: 1,
        createdBy: actor.userId, updatedBy: actor.userId, createdAt: undefined, updatedAt: undefined,
      }));
      await this.writeVersion(manager, 'order', reversal, null, 'create', `冲销：${dto.reason}`, actor, 'reversal');
      return this.orderItem(reversal);
    });
  }

  async listVersions(query: FactVersionQuery, actor: FactActor, admin: boolean): Promise<FactPage<FactVersionItem>> {
    const qb = this.versionRepo.createQueryBuilder('v');
    const cityIds = admin ? this.parseCityIds(query) : [this.requireCity(actor)];
    if (cityIds.length) qb.where('v.city_id IN (:...cityIds)', { cityIds });
    if (query.factKind) qb.andWhere('v.fact_type = :factKind', { factKind: query.factKind });
    if (query.lifecycleStatus) qb.andWhere('v.lifecycle_status = :lifecycleStatus', { lifecycleStatus: query.lifecycleStatus });
    if (query.year) qb.andWhere('v.period_year = :year', { year: Number(query.year) });
    if (query.month) qb.andWhere('v.period_month = :month', { month: Number(query.month) });
    if (query.contractId) qb.andWhere('v.contract_id = :contractId', { contractId: Number(query.contractId) });
    if (query.sourceType) qb.andWhere('v.source_type = :sourceType', { sourceType: query.sourceType });
    if (query.dateFrom) qb.andWhere('v.created_at >= :dateFrom', { dateFrom: query.dateFrom });
    if (query.dateTo) qb.andWhere('v.created_at <= :dateTo', { dateTo: query.dateTo });
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 20)));
    const [items, total] = await qb.orderBy('v.created_at', 'DESC').addOrderBy('v.id', 'DESC')
      .skip((page - 1) * pageSize).take(pageSize).getManyAndCount();
    return { items: items.map((item) => this.versionItem(item)), total, page, pageSize };
  }

  async getVersion(id: number, actor: FactActor, admin: boolean): Promise<FactVersionItem> {
    const version = await this.versionRepo.findOne({ where: { id } });
    if (!version) throw new NotFoundException('版本不存在');
    if (!admin && version.cityId !== this.requireCity(actor)) throw new NotFoundException('版本不存在');
    if (admin) {
      const allowed = this.parseCityIds({});
      if (allowed.length && (version.cityId === null || !allowed.includes(version.cityId))) throw new NotFoundException('版本不存在');
    }
    return this.versionItem(version);
  }

  private async casSave<T extends FactEntity>(repo: Repository<T>, fact: T, expectedVersionNo: number, actor: FactActor): Promise<void> {
    const result = await repo.update(
      { id: fact.id, cityId: fact.cityId, versionNo: expectedVersionNo } as never,
      fact as never,
    );
    if (!result.affected) await this.throwConflict(repo, fact.id, fact.cityId, actor);
  }

  private async throwConflict<T extends FactEntity>(repo: Repository<T>, id: number, cityId: number, actor: FactActor): Promise<never> {
    const current = await repo.findOne({ where: { id, cityId } as never });
    if (!current) throw new NotFoundException('事实记录不存在');
    throw new ConflictException({
      code: 'FACT_VERSION_CONFLICT',
      message: '数据已被其他操作更新，请重新载入',
      current: { factId: current.id, versionNo: current.versionNo, updatedAt: current.updatedAt.toISOString(), updatedBy: current.updatedBy },
      attemptedBy: actor.userId,
    });
  }

  private assertExpected(fact: FactEntity, expectedVersionNo: number): void {
    if (fact.versionNo !== expectedVersionNo) {
      throw new ConflictException({
        code: 'FACT_VERSION_CONFLICT',
        message: '数据已被其他操作更新，请重新载入',
        current: { factId: fact.id, versionNo: fact.versionNo, updatedAt: fact.updatedAt.toISOString(), updatedBy: fact.updatedBy },
      });
    }
  }

  private async writeVersion(
    manager: EntityManager,
    factType: 'cost' | 'order',
    after: FactEntity,
    before: FactEntity | null,
    changeType: 'create' | 'update' | 'reverse',
    reason: string,
    actor: FactActor,
    sourceType: string,
  ): Promise<void> {
    const versions = manager.getRepository(FactVersionEntity);
    const previous = before
      ? await versions.findOne({ where: { factType, factId: after.id, versionNo: before.versionNo } })
      : null;
    const created = await versions.save(versions.create({
      factType, factId: after.id, cityId: after.cityId, contractId: after.contractId,
      periodYear: after.periodYear, periodMonth: after.periodMonth, versionNo: after.versionNo,
      changeType, lifecycleStatus: 'current_effective', supersedesVersionId: previous?.id ?? null,
      supersededByVersionId: null, beforeDataJson: before, afterDataJson: after,
      changedFieldsJson: this.changedFields(before, after), warningSummaryJson: null,
      reason, operatorUserId: actor.userId, sourceType, importBatchId: after.importBatchId,
    }));
    if (previous) {
      previous.lifecycleStatus = 'replaced';
      previous.supersededByVersionId = created.id;
      await versions.save(previous);
    }
    await manager.getRepository(OperationLogEntity).save({
      operatorUserId: actor.userId, operatorCityId: after.cityId, actionType: `${factType}_${changeType}`,
      targetType: `${factType}_fact`, targetId: String(after.id), summaryText: reason,
      beforeDataJson: before, afterDataJson: after, resultStatus: 'success',
    });
  }

  private changedFields(before: FactEntity | null, after: FactEntity): string[] {
    if (!before) return Object.keys(after).filter((key) => !['createdAt', 'updatedAt'].includes(key));
    return Object.keys(after).filter((key) => JSON.stringify(after[key as keyof FactEntity]) !== JSON.stringify(before[key as keyof FactEntity]));
  }

  private versionItem(version: FactVersionEntity): FactVersionItem {
    return {
      id: version.id, factKind: version.factType, factId: Number(version.factId), cityId: version.cityId === null ? null : Number(version.cityId),
      contractId: version.contractId === null ? null : Number(version.contractId), periodYear: version.periodYear,
      periodMonth: version.periodMonth, versionNo: version.versionNo, changeType: version.changeType,
      lifecycleStatus: version.lifecycleStatus, supersedesVersionId: version.supersedesVersionId,
      supersededByVersionId: version.supersededByVersionId, changedFields: version.changedFieldsJson ?? [],
      warningSummary: version.warningSummaryJson ?? [], reason: version.reason, operatorUserId: Number(version.operatorUserId),
      sourceType: version.sourceType, importBatchId: version.importBatchId === null ? null : Number(version.importBatchId),
      beforeData: version.beforeDataJson, afterData: version.afterDataJson, createdAt: version.createdAt.toISOString(),
    };
  }

  private async assertAllocated(manager: EntityManager, cityId: number, contractId: number): Promise<void> {
    if (!await manager.getRepository(AllocationEntity).findOne({ where: { cityId, contractId } })) {
      throw new BadRequestException('合同未分配给当前地市');
    }
  }

  private async costItem(fact: CostFactEntity): Promise<CostFactItem> {
    const [contract, city] = await Promise.all([
      this.contractRepo.findOne({ where: { id: fact.contractId } }),
      this.cityRepo.findOne({ where: { id: fact.cityId } }),
    ]);
    return { ...fact, amount: Number(fact.amount), contractCode: contract?.contractCode ?? '', contractName: contract?.contractName ?? '',
      cityName: city?.name, occurredOn: String(fact.occurredOn), sourceType: fact.sourceType as CostFactItem['sourceType'],
      isReversed: Boolean(fact.isReversed), updatedAt: fact.updatedAt.toISOString() };
  }

  private async orderItem(fact: OrderFactEntity): Promise<OrderFactItem> {
    const [contract, city] = await Promise.all([
      this.contractRepo.findOne({ where: { id: fact.contractId } }),
      this.cityRepo.findOne({ where: { id: fact.cityId } }),
    ]);
    return { ...fact, taxInclusiveAmount: Number(fact.taxInclusiveAmount), contractCode: contract?.contractCode ?? '', contractName: contract?.contractName ?? '',
      cityName: city?.name, orderedAt: fact.orderedAt.toISOString(), sourceType: fact.sourceType as OrderFactItem['sourceType'],
      isReversal: Boolean(fact.isReversal), updatedAt: fact.updatedAt.toISOString() };
  }

  private parseCityIds(query: FactVersionQuery): number[] {
    const raw = query.cityIds as unknown;
    const values = Array.isArray(raw) ? raw : raw === undefined || raw === null || raw === '' ? [] : String(raw).split(',');
    const parsed = values.map(Number).filter((value) => Number.isInteger(value) && value > 0);
    if (query.cityId) parsed.push(Number(query.cityId));
    return [...new Set(parsed)];
  }

  private requireCity(actor: FactActor): number {
    if (!actor.cityId) throw new BadRequestException('当前地市账号未绑定地市');
    return Number(actor.cityId);
  }
  private assertMutation(reason: string, expectedVersionNo: number): void {
    if (!reason?.trim()) throw new BadRequestException('必须填写修改原因');
    if (!Number.isInteger(Number(expectedVersionNo)) || Number(expectedVersionNo) < 1) throw new BadRequestException('expectedVersionNo 必须是正整数');
  }
  private requiredText(value: unknown, field: string): string { const text = String(value ?? '').trim(); if (!text) throw new BadRequestException(`${field}不能为空`); return text; }
  private nullText(value: unknown): string | null { const text = String(value ?? '').trim(); return text || null; }
  private requireDate(value: string, field: string): Date { const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new BadRequestException(`${field}无效`); return date; }
  private requireAmount(value: number, allowNegative: boolean): number { const amount = Number(value); if (!Number.isFinite(amount) || amount === 0 || (!allowNegative && amount < 0)) throw new BadRequestException(allowNegative ? '金额必须是非零数字，负数冲销允许' : '成本金额必须是正数'); return amount; }
  private orderKey(row: OrderFactEntity | Record<string, unknown>): string {
    const value = row as Record<string, unknown>;
    return createHash('sha256').update([
      value.purchaseOrderNo, value.materialCode, value.projectCode, value.siteCode,
      new Date(String(value.orderedAt)).toISOString(), Number(value.taxInclusiveAmount).toFixed(2), value.quantity ?? '',
    ].map((item) => String(item ?? '').trim()).join('|')).digest('hex');
  }
}
