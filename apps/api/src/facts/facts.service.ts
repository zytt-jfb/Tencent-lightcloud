import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { DataSource, EntityManager, In, ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';
import type {
  ContractProgressFactItem, CostFactItem, CreateCostFactRequest, CreateOrderFactRequest, FactAggregateResponse, FactListQuery,
  FactPage, LocalContractItem, OrderFactItem, UpdateCostFactRequest, UpdateOrderFactRequest,
} from '@biz-reporting/shared-types';
import { SoftDeleteFlag, type FactSourceType } from '@biz-reporting/shared-types';
import { AllocationEntity } from '../contracts/allocation.entity';
import { ContractEntity } from '../contracts/contract.entity';
import { CityEntity } from '../cities/city.entity';
import { OperationLogEntity } from '../common/entities/operation-log.entity';
import { AnnualPackageEntity } from '../packages/annual-package.entity';
import { ContractMonthRowEntity } from '../packages/contract-month-row.entity';
import { CostMonthRowEntity } from '../packages/cost-month-row.entity';
import { CostFactEntity } from './cost-fact.entity';
import { FactVersionEntity } from './fact-version.entity';
import { OrderFactEntity } from './order-fact.entity';

export interface FactActor { userId: number; role: string; cityId: number | null }

@Injectable()
export class FactsService {
  constructor(
    @InjectRepository(CostFactEntity) private readonly costRepo: Repository<CostFactEntity>,
    @InjectRepository(OrderFactEntity) private readonly orderRepo: Repository<OrderFactEntity>,
    @InjectRepository(ContractEntity) private readonly contractRepo: Repository<ContractEntity>,
    @InjectRepository(AllocationEntity) private readonly allocationRepo: Repository<AllocationEntity>,
    @InjectRepository(CityEntity) private readonly cityRepo: Repository<CityEntity>,
    @InjectRepository(AnnualPackageEntity) private readonly packageRepo: Repository<AnnualPackageEntity>,
    @InjectRepository(ContractMonthRowEntity) private readonly progressRepo: Repository<ContractMonthRowEntity>,
    @InjectRepository(CostMonthRowEntity) private readonly budgetRepo: Repository<CostMonthRowEntity>,
    private readonly dataSource: DataSource,
  ) {}

  listCosts(query: FactListQuery, actor: FactActor, admin = false): Promise<FactPage<CostFactItem>> {
    const cityIds = this.scopeCities(query, actor, admin);
    const qb = this.costRepo.createQueryBuilder('f')
      .innerJoin(ContractEntity, 'c', 'c.id = f.contract_id')
      .innerJoin(CityEntity, 'city', 'city.id = f.city_id')
      .select(['f', 'c.contract_code AS contractCode', 'c.contract_name AS contractName', 'city.name AS cityName']);
    if (cityIds.length) qb.where('f.city_id IN (:...cityIds)', { cityIds });
    this.applyCommonFilters(qb, query, 'f');
    if (query.costCategory) qb.andWhere('f.cost_category_code = :costCategory', { costCategory: query.costCategory });
    if (query.keyword) qb.andWhere('(f.description LIKE :keyword OR c.contract_code LIKE :keyword OR c.contract_name LIKE :keyword)', { keyword: `%${query.keyword}%` });
    return this.paginateCost(qb, query);
  }

  listOrders(query: FactListQuery, actor: FactActor, admin = false): Promise<FactPage<OrderFactItem>> {
    const cityIds = this.scopeCities(query, actor, admin);
    const qb = this.orderRepo.createQueryBuilder('f')
      .innerJoin(ContractEntity, 'c', 'c.id = f.contract_id')
      .innerJoin(CityEntity, 'city', 'city.id = f.city_id')
      .select(['f', 'c.contract_code AS contractCode', 'c.contract_name AS contractName', 'city.name AS cityName']);
    if (cityIds.length) qb.where('f.city_id IN (:...cityIds)', { cityIds });
    this.applyCommonFilters(qb, query, 'f');
    if (query.orderStatus) qb.andWhere('f.order_status = :orderStatus', { orderStatus: query.orderStatus });
    if (query.keyword) qb.andWhere('(f.purchase_order_no LIKE :keyword OR f.material_name LIKE :keyword OR c.contract_code LIKE :keyword)', { keyword: `%${query.keyword}%` });
    return this.paginateOrder(qb, query);
  }

  async createCost(dto: CreateCostFactRequest, actor: FactActor): Promise<CostFactItem> {
    const cityId = this.requireCity(actor);
    await this.assertAllocated(cityId, dto.contractId);
    this.assertReason(dto.reason);
    const occurred = this.requireDate(dto.occurredOn, '发生日期');
    const amount = this.requireAmount(dto.amount, false);
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(CostFactEntity);
      const fact = await repo.save(repo.create({
        cityId, contractId: dto.contractId, occurredOn: dto.occurredOn,
        periodYear: occurred.getFullYear(), periodMonth: occurred.getMonth() + 1,
        costCategoryCode: this.requiredText(dto.costCategoryCode, '成本类别'), costSubtype: this.nullText(dto.costSubtype),
        description: this.requiredText(dto.description, '事由'), amount,
        actualSpender: this.nullText(dto.actualSpender), advancePayer: this.nullText(dto.advancePayer),
        receiptType: this.nullText(dto.receiptType), approvalNumber: this.nullText(dto.approvalNumber),
        approvalStatus: this.nullText(dto.approvalStatus), dingTalkDataId: null, mileage: null,
        locationsJson: null, attachmentsJson: null, rawPayloadJson: null, sourceType: 'manual',
        importBatchId: null, sourceRowId: null, reversedFactId: null, isReversed: 0, versionNo: 1,
        createdBy: actor.userId, updatedBy: actor.userId,
      }));
      await this.writeAudit(manager, 'cost', fact, null, 'create', dto.reason, actor, 'manual');
      return this.getCostItem(fact.id, cityId, manager.getRepository(CostFactEntity));
    });
  }

  async updateCost(id: number, dto: UpdateCostFactRequest, actor: FactActor): Promise<CostFactItem> {
    const cityId = this.requireCity(actor); this.assertReason(dto.reason);
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(CostFactEntity);
      const fact = await repo.findOne({ where: { id, cityId } });
      if (!fact) throw new NotFoundException('成本记录不存在');
      if (fact.isReversed) throw new ConflictException('已撤销的成本记录不能继续编辑');
      const before = { ...fact };
      if (dto.contractId !== undefined) { await this.assertAllocated(cityId, dto.contractId); fact.contractId = dto.contractId; }
      if (dto.occurredOn !== undefined) { const date = this.requireDate(dto.occurredOn, '发生日期'); fact.occurredOn = dto.occurredOn; fact.periodYear = date.getFullYear(); fact.periodMonth = date.getMonth() + 1; }
      if (dto.costCategoryCode !== undefined) fact.costCategoryCode = this.requiredText(dto.costCategoryCode, '成本类别');
      if (dto.costSubtype !== undefined) fact.costSubtype = this.nullText(dto.costSubtype);
      if (dto.description !== undefined) fact.description = this.requiredText(dto.description, '事由');
      if (dto.amount !== undefined) fact.amount = this.requireAmount(dto.amount, false);
      if (dto.actualSpender !== undefined) fact.actualSpender = this.nullText(dto.actualSpender);
      if (dto.advancePayer !== undefined) fact.advancePayer = this.nullText(dto.advancePayer);
      if (dto.receiptType !== undefined) fact.receiptType = this.nullText(dto.receiptType);
      if (dto.approvalNumber !== undefined) fact.approvalNumber = this.nullText(dto.approvalNumber);
      if (dto.approvalStatus !== undefined) fact.approvalStatus = this.nullText(dto.approvalStatus);
      fact.versionNo += 1; fact.updatedBy = actor.userId;
      const saved = await repo.save(fact);
      await this.writeAudit(manager, 'cost', saved, before, 'update', dto.reason, actor, 'manual');
      return this.getCostItem(saved.id, cityId, repo);
    });
  }

  async reverseCost(id: number, reason: string, actor: FactActor): Promise<CostFactItem> {
    const cityId = this.requireCity(actor); this.assertReason(reason);
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(CostFactEntity);
      const original = await repo.findOne({ where: { id, cityId } });
      if (!original) throw new NotFoundException('成本记录不存在');
      if (original.isReversed) throw new ConflictException('该成本记录已撤销');
      const before = { ...original }; original.isReversed = 1; original.versionNo += 1; original.updatedBy = actor.userId; await repo.save(original);
      const reversal = await repo.save(repo.create({ ...original, id: undefined, amount: -Number(original.amount), sourceType: 'reversal', importBatchId: null,
        sourceRowId: null, reversedFactId: original.id, isReversed: 0, versionNo: 1, createdBy: actor.userId, updatedBy: actor.userId,
        createdAt: undefined, updatedAt: undefined }));
      await this.writeAudit(manager, 'cost', original, before, 'reverse', reason, actor, 'reversal');
      await this.writeAudit(manager, 'cost', reversal, null, 'create', `冲销：${reason}`, actor, 'reversal');
      return this.getCostItem(reversal.id, cityId, repo);
    });
  }

  async createOrder(dto: CreateOrderFactRequest, actor: FactActor): Promise<OrderFactItem> {
    const cityId = this.requireCity(actor); await this.assertAllocated(cityId, dto.contractId); this.assertReason(dto.reason);
    const orderedAt = this.requireDate(dto.orderedAt, '下单时间');
    const data = this.normalizeOrderInput(dto, orderedAt);
    const businessKey = this.orderKey(data);
    if (await this.orderRepo.findOne({ where: { cityId, businessKey } })) throw new ConflictException('行级业务键冲突');
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(OrderFactEntity);
      const fact = await repo.save(repo.create({ cityId, ...data, businessKey, periodYear: orderedAt.getFullYear(), periodMonth: orderedAt.getMonth() + 1,
        sourceType: 'manual', importBatchId: null, sourceRowId: null, isReversal: data.taxInclusiveAmount < 0 ? 1 : 0,
        isReversed: 0, reversedFactId: null, rawPayloadJson: null, versionNo: 1, createdBy: actor.userId, updatedBy: actor.userId }));
      await this.writeAudit(manager, 'order', fact, null, 'create', dto.reason, actor, 'manual');
      return this.getOrderItem(fact.id, cityId, repo);
    });
  }

  async updateOrder(id: number, dto: UpdateOrderFactRequest, actor: FactActor): Promise<OrderFactItem> {
    const cityId = this.requireCity(actor); this.assertReason(dto.reason);
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(OrderFactEntity);
      const fact = await repo.findOne({ where: { id, cityId } });
      if (!fact) throw new NotFoundException('订单记录不存在');
      if (fact.isReversed) throw new ConflictException('已撤销的订单记录不能继续编辑');
      const before = { ...fact };
      if (dto.contractId !== undefined) { await this.assertAllocated(cityId, dto.contractId); fact.contractId = dto.contractId; }
      if (dto.purchaseOrderNo !== undefined) fact.purchaseOrderNo = this.requiredText(dto.purchaseOrderNo, '采购订单编号');
      if (dto.orderStatus !== undefined) fact.orderStatus = this.requiredText(dto.orderStatus, '订单状态');
      if (dto.taxInclusiveAmount !== undefined) fact.taxInclusiveAmount = this.requireAmount(dto.taxInclusiveAmount, true);
      if (dto.materialName !== undefined) fact.materialName = this.requiredText(dto.materialName, '物料名称');
      if (dto.materialCode !== undefined) fact.materialCode = this.requiredText(dto.materialCode, '物料编码');
      if (dto.projectCode !== undefined) fact.projectCode = this.nullText(dto.projectCode);
      if (dto.projectName !== undefined) fact.projectName = this.nullText(dto.projectName);
      if (dto.siteCode !== undefined) fact.siteCode = this.nullText(dto.siteCode);
      if (dto.siteName !== undefined) fact.siteName = this.nullText(dto.siteName);
      if (dto.receiptStatus !== undefined) fact.receiptStatus = this.nullText(dto.receiptStatus);
      if (dto.orderedAt !== undefined) { const date = this.requireDate(dto.orderedAt, '下单时间'); fact.orderedAt = date; fact.periodYear = date.getFullYear(); fact.periodMonth = date.getMonth() + 1; }
      fact.businessKey = this.orderKey(fact); fact.isReversal = Number(fact.taxInclusiveAmount) < 0 ? 1 : 0; fact.versionNo += 1; fact.updatedBy = actor.userId;
      const conflict = await repo.findOne({ where: { cityId, businessKey: fact.businessKey } });
      if (conflict && Number(conflict.id) !== Number(id)) throw new ConflictException('行级业务键冲突');
      const saved = await repo.save(fact);
      await this.writeAudit(manager, 'order', saved, before, 'update', dto.reason, actor, 'manual');
      return this.getOrderItem(saved.id, cityId, repo);
    });
  }

  async reverseOrder(id: number, reason: string, actor: FactActor): Promise<OrderFactItem> {
    const cityId = this.requireCity(actor); this.assertReason(reason);
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(OrderFactEntity);
      const original = await repo.findOne({ where: { id, cityId } });
      if (!original) throw new NotFoundException('订单记录不存在');
      if (original.isReversed) throw new ConflictException('该订单记录已撤销');
      const before = { ...original }; original.isReversed = 1; original.versionNo += 1; original.updatedBy = actor.userId; await repo.save(original);
      const reversalData = { ...original, purchaseOrderNo: `${original.purchaseOrderNo}-冲销-${Date.now()}`, taxInclusiveAmount: -Number(original.taxInclusiveAmount) };
      const reversal = await repo.save(repo.create({ ...reversalData, id: undefined, businessKey: this.orderKey(reversalData), sourceType: 'reversal', importBatchId: null,
        sourceRowId: null, isReversal: 1, isReversed: 0, reversedFactId: original.id, versionNo: 1,
        createdBy: actor.userId, updatedBy: actor.userId, createdAt: undefined, updatedAt: undefined }));
      await this.writeAudit(manager, 'order', original, before, 'reverse', reason, actor, 'reversal');
      await this.writeAudit(manager, 'order', reversal, null, 'create', `冲销：${reason}`, actor, 'reversal');
      return this.getOrderItem(reversal.id, cityId, repo);
    });
  }

  async localContracts(query: FactListQuery, actor: FactActor): Promise<LocalContractItem[]> {
    const cityId = this.requireCity(actor);
    const allocations = await this.allocationRepo.find({ where: { cityId } });
    if (!allocations.length) return [];
    const contracts = await this.contractRepo.find({ where: { id: In(allocations.map((item) => item.contractId)), isDeleted: SoftDeleteFlag.NOT_DELETED } });
    const summary = await this.aggregate({ ...query, cityId }, actor, false);
    const allocationByContractId = new Map(allocations.map((item) => [Number(item.contractId), item]));
    const summaryMap = new Map(summary.items.map((item) => [Number(item.contractId), item]));
    return contracts.flatMap((contract) => {
      const contractId = Number(contract.id);
      const allocation = allocationByContractId.get(contractId);
      if (!allocation) return [];
      const item = summaryMap.get(contractId) ?? this.emptyAggregate(cityId, '', contract);
      return [{ ...item, effectiveRate: Number(allocation.rate), allocationAmount: Number(allocation.cityContractAmount),
        signDate: contract.signDate ? String(contract.signDate) : null, expireDate: contract.expireDate ? String(contract.expireDate) : null }];
    });
  }

  async aggregate(query: FactListQuery, actor: FactActor, admin: boolean): Promise<FactAggregateResponse> {
    if (!admin) {
      const cityId = this.requireCity(actor);
      return this.aggregateCity({ ...query, cityId }, cityId);
    }
    const requestedCityIds = this.parseRequestedCityIds(query);
    const cities = await this.cityRepo.find({
      where: requestedCityIds.length ? { id: In(requestedCityIds), isDeleted: SoftDeleteFlag.NOT_DELETED } : { isDeleted: SoftDeleteFlag.NOT_DELETED },
      order: { sortOrder: 'ASC', id: 'ASC' },
    });
    if (requestedCityIds.length === 1 && cities.length === 1) return this.aggregateCity(query, cities[0].id);
    const cityResults = await Promise.all(cities.map((city) => this.aggregateCity({ ...query, cityId: city.id }, city.id)));
    const totals = cityResults.reduce((sum, result) => this.addTotals(sum, result.totals), this.emptyTotals());
    return {
      scope: requestedCityIds.length ? 'selection' : 'province',
      items: cityResults.flatMap((result) => result.items),
      totals,
      cities: cityResults.map((result, index) => ({
        cityId: cities[index].id,
        cityName: cities[index].name,
        contractCount: result.items.length,
        dataMonthCount: result.dataMonthCount ?? 0,
        totals: result.totals,
      })),
      formulaVersion: 'facts-v1',
    };
  }

  async listProgress(query: FactListQuery, actor: FactActor, admin = false): Promise<ContractProgressFactItem[]> {
    const cityIds = this.scopeCities(query, actor, admin);
    const packagesQb = this.packageRepo.createQueryBuilder('p')
      .innerJoin(CityEntity, 'city', 'city.id = p.city_id')
      .select(['p.id AS packageId', 'p.city_id AS cityId', 'p.report_year AS reportYear', 'city.name AS cityName']);
    if (cityIds.length) packagesQb.where('p.city_id IN (:...cityIds)', { cityIds });
    if (query.year) packagesQb.andWhere('p.report_year = :year', { year: Number(query.year) });
    const packageRows = await packagesQb.getRawMany<{ packageId: number; cityId: number; reportYear: number; cityName: string }>();
    if (!packageRows.length) return [];
    const packageById = new Map(packageRows.map((row) => [Number(row.packageId), row]));
    const qb = this.progressRepo.createQueryBuilder('r')
      .innerJoin(ContractEntity, 'c', 'c.id = r.contract_id')
      .select(['r', 'c.contract_code AS contractCode', 'c.contract_name AS contractName'])
      .where('r.package_id IN (:...packageIds)', { packageIds: [...packageById.keys()] });
    if (query.month) qb.andWhere('r.month_no = :month', { month: Number(query.month) });
    if (query.contractId) qb.andWhere('r.contract_id = :contractId', { contractId: Number(query.contractId) });
    const rows = await qb.orderBy('r.month_no', 'ASC').addOrderBy('r.contract_id', 'ASC').getRawAndEntities();
    return rows.entities.map((row, index) => {
      const pkg = packageById.get(Number(row.packageId))!;
      const raw = rows.raw[index] as { contractCode?: string; contractName?: string };
      return {
        cityId: Number(pkg.cityId), cityName: pkg.cityName, contractId: Number(row.contractId),
        contractCode: raw.contractCode ?? '', contractName: raw.contractName ?? '',
        year: Number(pkg.reportYear), month: Number(row.monthNo),
        completionAmount: Number(row.completionAmount), acceptanceAmount: Number(row.acceptanceAmount),
        invoiceAmount: Number(row.invoiceAmount),
      };
    });
  }

  private async aggregateCity(query: FactListQuery, cityId: number): Promise<FactAggregateResponse> {
    const allocations = await this.allocationRepo.find({ where: { cityId } });
    const contractIds = query.contractId ? [query.contractId] : allocations.map((item) => item.contractId);
    const contracts = contractIds.length ? await this.contractRepo.find({ where: { id: In(contractIds) } }) : [];
    const city = await this.cityRepo.findOne({ where: { id: cityId } });
    const packageIds = (await this.packageRepo.find({ where: query.year ? { cityId, reportYear: query.year } : { cityId } })).map((item) => item.id);
    const costQuery = this.filteredFacts(this.costRepo.createQueryBuilder('f'), query, cityId);
    if (query.costCategory) costQuery.andWhere('f.cost_category_code = :costCategory', { costCategory: query.costCategory });
    const orderQuery = this.filteredFacts(this.orderRepo.createQueryBuilder('f'), query, cityId);
    if (query.orderStatus) orderQuery.andWhere('f.order_status = :orderStatus', { orderStatus: query.orderStatus });
    const costs = await costQuery.getMany();
    const orders = await orderQuery.getMany();
    const progress = packageIds.length ? await this.progressRepo.find({ where: { packageId: In(packageIds), ...(query.month ? { monthNo: query.month } : {}) } }) : [];
    const budgets = packageIds.length ? await this.budgetRepo.find({ where: { packageId: In(packageIds), ...(query.month ? { monthNo: query.month } : {}) } }) : [];
    const budgetTotal = budgets.reduce((sum, row) => sum + Number(row.amount), 0);
    const items = contracts.map((contract) => {
      const contractId = Number(contract.id);
      const allocation = allocations.find((item) => Number(item.contractId) === contractId);
      const contractCosts = costs.filter((item) => Number(item.contractId) === contractId);
      const contractOrders = orders.filter((item) => Number(item.contractId) === contractId);
      const actualCost = contractCosts.reduce((sum, item) => sum + Number(item.amount), 0);
      const orderAmount = contractOrders.reduce((sum, item) => sum + Number(item.taxInclusiveAmount), 0);
      const rows = progress.filter((item) => Number(item.contractId) === contractId);
      const completionAmount = rows.reduce((sum, item) => sum + Number(item.completionAmount), 0);
      const acceptanceAmount = rows.reduce((sum, item) => sum + Number(item.acceptanceAmount), 0);
      const invoiceAmount = rows.reduce((sum, item) => sum + Number(item.invoiceAmount), 0);
      const effectiveRate = Number(allocation?.rate ?? contract.rate ?? 0);
      const grossProfit = acceptanceAmount * effectiveRate;
      const predictedGrossProfit = 0;
      const updated = [...contractCosts, ...contractOrders]
        .map((item) => item.updatedAt).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
      return { cityId, cityName: city?.name ?? '', contractId, contractCode: contract.contractCode,
        contractName: contract.contractName, actualCost, costBudget: 0, orderAmount, completionAmount, acceptanceAmount, invoiceAmount,
        grossProfit, actualNetProfit: grossProfit - actualCost, predictedGrossProfit, predictedNetProfit: predictedGrossProfit,
        effectiveRate, updatedAt: updated?.toISOString() ?? null };
    });
    const totals = items.reduce((sum, item) => ({ actualCost: sum.actualCost + item.actualCost, costBudget: sum.costBudget + item.costBudget,
      orderAmount: sum.orderAmount + item.orderAmount, completionAmount: sum.completionAmount + item.completionAmount,
      acceptanceAmount: sum.acceptanceAmount + item.acceptanceAmount, invoiceAmount: sum.invoiceAmount + item.invoiceAmount,
      grossProfit: sum.grossProfit + item.grossProfit,
      actualNetProfit: sum.actualNetProfit + item.actualNetProfit, predictedGrossProfit: sum.predictedGrossProfit + item.predictedGrossProfit,
      predictedNetProfit: sum.predictedNetProfit + item.predictedNetProfit }),
      { actualCost: 0, costBudget: 0, orderAmount: 0, completionAmount: 0, acceptanceAmount: 0, invoiceAmount: 0,
        grossProfit: 0, actualNetProfit: 0, predictedGrossProfit: 0, predictedNetProfit: 0 });
    totals.costBudget = budgetTotal;
    totals.predictedNetProfit = totals.predictedGrossProfit - budgetTotal;
    const dataMonthCount = new Set([
      ...progress.map((row) => Number(row.monthNo)),
      ...costs.map((row) => Number(row.periodMonth)),
      ...orders.map((row) => Number(row.periodMonth)),
    ]).size;
    return { scope: 'city', items, totals, dataMonthCount, formulaVersion: 'facts-v1' };
  }

  private emptyTotals(): FactAggregateResponse['totals'] {
    return { actualCost: 0, costBudget: 0, orderAmount: 0, completionAmount: 0, acceptanceAmount: 0, invoiceAmount: 0,
      grossProfit: 0, actualNetProfit: 0, predictedGrossProfit: 0, predictedNetProfit: 0 };
  }

  private addTotals(left: FactAggregateResponse['totals'], right: FactAggregateResponse['totals']): FactAggregateResponse['totals'] {
    return { actualCost: left.actualCost + right.actualCost, costBudget: left.costBudget + right.costBudget,
      orderAmount: left.orderAmount + right.orderAmount, completionAmount: left.completionAmount + right.completionAmount,
      acceptanceAmount: left.acceptanceAmount + right.acceptanceAmount, invoiceAmount: left.invoiceAmount + right.invoiceAmount,
      grossProfit: left.grossProfit + right.grossProfit,
      actualNetProfit: left.actualNetProfit + right.actualNetProfit, predictedGrossProfit: left.predictedGrossProfit + right.predictedGrossProfit,
      predictedNetProfit: left.predictedNetProfit + right.predictedNetProfit };
  }

  private filteredFacts<T extends ObjectLiteral>(qb: SelectQueryBuilder<T>, query: FactListQuery, cityId: number): SelectQueryBuilder<T> {
    qb.where('f.city_id = :cityId', { cityId }); this.applyCommonFilters(qb, query, 'f'); return qb;
  }
  private applyCommonFilters<T extends ObjectLiteral>(qb: SelectQueryBuilder<T>, query: FactListQuery, alias: string) {
    if (query.year) qb.andWhere(`${alias}.period_year = :year`, { year: query.year });
    if (query.month) qb.andWhere(`${alias}.period_month = :month`, { month: query.month });
    if (query.contractId) qb.andWhere(`${alias}.contract_id = :contractId`, { contractId: query.contractId });
    if (query.sourceType) qb.andWhere(`${alias}.source_type = :sourceType`, { sourceType: query.sourceType });
  }
  private async paginateCost(qb: SelectQueryBuilder<CostFactEntity>, query: FactListQuery): Promise<FactPage<CostFactItem>> {
    const page = Math.max(1, Number(query.page || 1)); const pageSize = Math.min(10000, Math.max(1, Number(query.pageSize || 20)));
    const total = await qb.clone().getCount(); const rows = await qb.orderBy('f.occurred_on', 'DESC').addOrderBy('f.id', 'DESC').offset((page - 1) * pageSize).limit(pageSize).getRawAndEntities();
    return { items: rows.entities.map((item, index) => this.mapCost(item, rows.raw[index])), total, page, pageSize };
  }
  private async paginateOrder(qb: SelectQueryBuilder<OrderFactEntity>, query: FactListQuery): Promise<FactPage<OrderFactItem>> {
    const page = Math.max(1, Number(query.page || 1)); const pageSize = Math.min(10000, Math.max(1, Number(query.pageSize || 20)));
    const total = await qb.clone().getCount(); const rows = await qb.orderBy('f.ordered_at', 'DESC').addOrderBy('f.id', 'DESC').offset((page - 1) * pageSize).limit(pageSize).getRawAndEntities();
    return { items: rows.entities.map((item, index) => this.mapOrder(item, rows.raw[index])), total, page, pageSize };
  }
  private async getCostItem(id: number, cityId: number, repo = this.costRepo): Promise<CostFactItem> {
    const fact = await repo.findOne({ where: { id, cityId } }); if (!fact) throw new NotFoundException('成本记录不存在');
    const contract = await this.contractRepo.findOne({ where: { id: fact.contractId } }); const city = await this.cityRepo.findOne({ where: { id: cityId } });
    return this.mapCost(fact, { contractCode: contract?.contractCode, contractName: contract?.contractName, cityName: city?.name });
  }
  private async getOrderItem(id: number, cityId: number, repo = this.orderRepo): Promise<OrderFactItem> {
    const fact = await repo.findOne({ where: { id, cityId } }); if (!fact) throw new NotFoundException('订单记录不存在');
    const contract = await this.contractRepo.findOne({ where: { id: fact.contractId } }); const city = await this.cityRepo.findOne({ where: { id: cityId } });
    return this.mapOrder(fact, { contractCode: contract?.contractCode, contractName: contract?.contractName, cityName: city?.name });
  }
  private mapCost(f: CostFactEntity, raw: { contractCode?: string | null; contractName?: string | null; cityName?: string | null }): CostFactItem { return { ...f, amount: Number(f.amount), contractCode: raw.contractCode ?? '', contractName: raw.contractName ?? '', cityName: raw.cityName ?? undefined,
    occurredOn: String(f.occurredOn), sourceType: f.sourceType as FactSourceType, isReversed: Boolean(f.isReversed), updatedAt: f.updatedAt.toISOString() }; }
  private mapOrder(f: OrderFactEntity, raw: { contractCode?: string | null; contractName?: string | null; cityName?: string | null }): OrderFactItem { return { ...f, taxInclusiveAmount: Number(f.taxInclusiveAmount), contractCode: raw.contractCode ?? '', contractName: raw.contractName ?? '', cityName: raw.cityName ?? undefined,
    orderedAt: f.orderedAt.toISOString(), sourceType: f.sourceType as FactSourceType, isReversal: Boolean(f.isReversal), updatedAt: f.updatedAt.toISOString() }; }
  private scopeCities(query: FactListQuery, actor: FactActor, admin: boolean): number[] {
    return admin ? this.parseRequestedCityIds(query) : [this.requireCity(actor)];
  }
  private parseRequestedCityIds(query: FactListQuery): number[] {
    const raw = query.cityIds as unknown;
    const values = Array.isArray(raw)
      ? raw
      : raw === undefined || raw === null || raw === ''
        ? []
        : String(raw).split(',');
    const parsed = values.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0);
    if (query.cityId !== undefined && query.cityId !== null && query.cityId !== ('' as unknown as number)) {
      const cityId = Number(query.cityId);
      if (Number.isInteger(cityId) && cityId > 0) parsed.push(cityId);
    }
    return [...new Set(parsed)];
  }
  private requireCity(actor: FactActor): number { if (!actor.cityId) throw new BadRequestException('当前地市账号未绑定地市'); return Number(actor.cityId); }
  private async assertAllocated(cityId: number, contractId: number) { if (!await this.allocationRepo.findOne({ where: { cityId, contractId } })) throw new BadRequestException('合同未分配给当前地市'); }
  private assertReason(reason: string) { if (!reason?.trim()) throw new BadRequestException('必须填写修改原因'); }
  private requiredText(value: unknown, field: string): string { const text = String(value ?? '').trim(); if (!text) throw new BadRequestException(`${field}不能为空`); return text; }
  private nullText(value: unknown): string | null { const text = String(value ?? '').trim(); return text || null; }
  private requireDate(value: string, field: string): Date { const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new BadRequestException(`${field}无效`); return date; }
  private requireAmount(value: number, allowNegative: boolean): number { const amount = Number(value); if (!Number.isFinite(amount) || amount === 0 || (!allowNegative && amount < 0)) throw new BadRequestException(allowNegative ? '金额必须是非零数字，负数冲销允许' : '成本金额必须是正数'); return amount; }
  private normalizeOrderInput(dto: CreateOrderFactRequest, orderedAt: Date) { return { contractId: dto.contractId, purchaseOrderNo: this.requiredText(dto.purchaseOrderNo, '采购订单编号'),
    orderStatus: this.requiredText(dto.orderStatus, '订单状态'), taxInclusiveAmount: this.requireAmount(dto.taxInclusiveAmount, true),
    materialName: this.requiredText(dto.materialName, '物料名称'), materialCode: this.requiredText(dto.materialCode, '物料编码'),
    projectCode: this.nullText(dto.projectCode), projectName: this.nullText(dto.projectName), siteCode: this.nullText(dto.siteCode), siteName: this.nullText(dto.siteName),
    orderedAt, receiptStatus: this.nullText(dto.receiptStatus) }; }
  private orderKey(row: { purchaseOrderNo: string; materialCode: string; projectCode: string | null; siteCode: string | null; orderedAt: Date | string; taxInclusiveAmount: number; quantity?: unknown }): string { return createHash('sha256').update([row.purchaseOrderNo, row.materialCode, row.projectCode, row.siteCode,
    new Date(row.orderedAt).toISOString(), Number(row.taxInclusiveAmount).toFixed(2), row.quantity ?? ''].map((value) => String(value ?? '').trim()).join('|')).digest('hex'); }
  private async writeAudit(
    manager: EntityManager, type: 'cost' | 'order', after: CostFactEntity | OrderFactEntity,
    before: CostFactEntity | OrderFactEntity | null, changeType: 'create' | 'update' | 'reverse',
    reason: string, actor: FactActor, sourceType: string,
  ) {
    const versionRepo = manager.getRepository(FactVersionEntity);
    const previous = before ? await versionRepo.findOne({ where: { factType: type, factId: after.id, versionNo: before.versionNo } }) : null;
    const version = await versionRepo.save(versionRepo.create({
      factType: type, factId: after.id, cityId: after.cityId, contractId: after.contractId,
      periodYear: after.periodYear, periodMonth: after.periodMonth, versionNo: after.versionNo, changeType,
      lifecycleStatus: 'current_effective', supersedesVersionId: previous?.id ?? null, supersededByVersionId: null,
      beforeDataJson: before, afterDataJson: after, changedFieldsJson: this.changedFields(before, after), warningSummaryJson: null,
      reason, operatorUserId: actor.userId, sourceType, importBatchId: after.importBatchId,
    }));
    if (previous) {
      previous.lifecycleStatus = 'replaced';
      previous.supersededByVersionId = version.id;
      await versionRepo.save(previous);
    }
    await manager.getRepository(OperationLogEntity).save({ operatorUserId: actor.userId, operatorCityId: actor.cityId,
      actionType: `${type}_${changeType}`, targetType: `${type}_fact`, targetId: String(after.id), summaryText: reason,
      beforeDataJson: before, afterDataJson: after, resultStatus: 'success' });
  }
  private changedFields(before: CostFactEntity | OrderFactEntity | null, after: CostFactEntity | OrderFactEntity): string[] {
    if (!before) return Object.keys(after).filter((key) => !['createdAt', 'updatedAt'].includes(key));
    return Object.keys(after).filter((key) => {
      const field = key as keyof typeof after;
      return JSON.stringify(after[field]) !== JSON.stringify(before[field]);
    });
  }
  private emptyAggregate(cityId: number, cityName: string, contract: ContractEntity) { return { cityId, cityName, contractId: contract.id, contractCode: contract.contractCode,
    contractName: contract.contractName, actualCost: 0, costBudget: 0, orderAmount: 0, completionAmount: 0, acceptanceAmount: 0, invoiceAmount: 0,
    grossProfit: 0, actualNetProfit: 0, predictedGrossProfit: 0, predictedNetProfit: 0, effectiveRate: 0, updatedAt: null }; }
}

