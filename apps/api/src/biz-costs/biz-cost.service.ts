import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import { CostStatus, PlatformRole } from '@biz-reporting/shared-types';
import { BizCostEntryEntity } from '../costs/biz-cost-entry.entity';
import { BizCostCategoryEntity } from '../costs/biz-cost-category.entity';
import { BizOperationLogEntity } from '../operation-logs/biz-operation-log.entity';
import { RbacService, BizAuthContext } from '../rbac/rbac.service';
import { BizAggregateService } from '../biz-aggregates/biz-aggregate.service';
import { CityEntity } from '../main-data/city.entity';
import { rethrowOptimisticLock } from '../common/optimistic-lock';

/** 未显式分页时的单次返回上限（防止省级账号一次性拉全表） */
const MAX_UNPAGINATED_ROWS = 5000;

export interface CostEntryDto {
  cityId?: string | null;
  businessMonth: string; // YYYY-MM
  categoryCode: string;
  amountFen: number;
  description?: string | null;
}

export interface MonthlyCostDto {
  cityId?: string | null;
  businessMonth: string;
  submit?: boolean;
  entries: Array<{ categoryCode: string; amountFen?: number | null; description?: string | null }>;
}

export interface MonthlyReturnDto {
  cityId: string;
  businessMonth: string;
  comment: string;
}

/**
 * 地市成本服务（新基线 M5）
 * 基线：01 §7 / 04 §6 —— 成本独立核算，不关联合同；
 *  - 分类必填且来自字典；金额 >0；月份非未来；
 *  - 成本提交即生效：draft/rejected → approved；管理员可将已生效记录退回，地市修改后重新提交；
 *  - 乐观锁并发（@VersionColumn）。
 */
@Injectable()
export class BizCostService {
  constructor(
    @InjectRepository(BizCostEntryEntity)
    private readonly costRepo: Repository<BizCostEntryEntity>,
    @InjectRepository(BizCostCategoryEntity)
    private readonly categoryRepo: Repository<BizCostCategoryEntity>,
    @InjectRepository(BizOperationLogEntity)
    private readonly opLogRepo: Repository<BizOperationLogEntity>,
    @InjectRepository(CityEntity)
    private readonly cityRepo: Repository<CityEntity>,
    private readonly dataSource: DataSource,
    private readonly rbac: RbacService,
    private readonly aggregates: BizAggregateService,
  ) {}

  private async recordOp(operatorId: string, actionType: string, targetId: string, resultStatus = 'success'): Promise<void> {
    await this.opLogRepo.save({
      id: randomUUID(), operatorUserId: operatorId, actionType,
      targetType: 'cost_entry', targetId, resultStatus,
    });
  }

  private async getOrFail(id: string): Promise<BizCostEntryEntity> {
    const item = await this.costRepo.findOneBy({ id });
    if (!item) throw new NotFoundException('成本记录不存在');
    return item;
  }

  /** 地市用户仅其数据范围内的地市（支持多城市） */
  private async assertCityAccess(auth: BizAuthContext, cityId: string | null): Promise<void> {
    if (auth.dataScope.scopeType === 'contract') throw new ForbiddenException('当前账号无成本数据范围');
    const allowedCityIds = auth.dataScope.cityIds?.length
      ? auth.dataScope.cityIds
      : auth.dataScope.cityId ? [auth.dataScope.cityId] : [];
    if (auth.roleCode === PlatformRole.CITY_USER) {
      if (!cityId || !allowedCityIds.includes(cityId)) throw new ForbiddenException('数据范围不足');
    } else if (cityId) {
      await this.rbac.assertCityScope(auth, cityId);
    }
  }

  private resolveCityId(auth: BizAuthContext, cityId?: string | null): string {
    const allowedCityIds = auth.dataScope.cityIds?.length
      ? auth.dataScope.cityIds
      : auth.dataScope.cityId ? [auth.dataScope.cityId] : [];
    // 多城市账号必须显式传地市；单城市账号自动取绑定地市
    const resolved = allowedCityIds.length === 1 ? allowedCityIds[0] : cityId;
    if (!resolved) throw new BadRequestException('请选择地市');
    return resolved;
  }

  private async assertRules(dto: CostEntryDto): Promise<void> {
    if (!Number.isFinite(dto.amountFen) || dto.amountFen <= 0) throw new BadRequestException('成本金额必须大于 0');
    if (!/^\d{4}-\d{2}$/.test(dto.businessMonth)) throw new BadRequestException('业务月份格式应为 YYYY-MM');
    const [year, month] = dto.businessMonth.split('-').map(Number);
    const now = new Date();
    if (year * 12 + month > now.getFullYear() * 12 + now.getMonth() + 1) throw new BadRequestException('业务月份不能是未来月份');
    if (!dto.categoryCode?.trim()) throw new BadRequestException('成本分类必填');
    const category = await this.categoryRepo.findOneBy({ code: dto.categoryCode });
    if (!category) throw new BadRequestException('成本分类不存在');
  }

  // ================= 列表/详情 =================

  async list(auth: BizAuthContext, filter: { cityId?: string; status?: string; businessMonth?: string; year?: string; categoryCode?: string; page?: number; pageSize?: number }): Promise<{ items: Array<BizCostEntryEntity & { cityName?: string }>; total: number; page: number; pageSize: number }> {
    if (filter.cityId) await this.assertCityAccess(auth, filter.cityId);
    const qb = this.costRepo.createQueryBuilder('c');
    if (auth.dataScope.scopeType === 'contract') throw new ForbiddenException('当前账号无成本数据范围');
    if (auth.dataScope.cityIds?.length) {
      qb.andWhere('c.cityId IN (:...scopeCityIds)', { scopeCityIds: auth.dataScope.cityIds });
    } else if (auth.dataScope.scopeType === 'city') {
      qb.andWhere('c.cityId = :scopeCityId', { scopeCityId: auth.dataScope.cityId });
    }
    if (auth.dataScope.scopeType === 'province' && auth.dataScope.provinceIds.length > 0) {
      const cities = await this.cityRepo.find({ where: { provinceId: In(auth.dataScope.provinceIds) } });
      const cityIds = cities.map((city) => city.id);
      if (cityIds.length === 0) qb.andWhere('1 = 0');
      else qb.andWhere('c.cityId IN (:...scopeCityIds)', { scopeCityIds: cityIds });
    }
    if (filter.cityId) qb.andWhere('c.cityId = :cityId', { cityId: filter.cityId });
    if (filter.status) qb.andWhere('c.status = :status', { status: filter.status });
    if (filter.businessMonth) qb.andWhere('c.businessMonth = :businessMonth', { businessMonth: filter.businessMonth });
    if (filter.year) qb.andWhere('c.businessMonth LIKE :yearPrefix', { yearPrefix: `${filter.year}-%` });
    if (filter.categoryCode) qb.andWhere('c.categoryCode = :categoryCode', { categoryCode: filter.categoryCode });
    const total = await qb.getCount();
    // pageSize 缺省 = 全量返回（上限 MAX_UNPAGINATED_ROWS）；显式传值则分页
    const requestedPageSize = Math.trunc(filter.pageSize ?? 0);
    const page = Math.max(1, Math.trunc(filter.page ?? 1));
    const effectivePageSize = requestedPageSize > 0
      ? Math.min(1000, requestedPageSize)
      : Math.min(MAX_UNPAGINATED_ROWS, total);
    const ordered = qb.orderBy('c.createdAt', 'DESC');
    const items = requestedPageSize > 0
      ? await ordered.skip((page - 1) * effectivePageSize).take(effectivePageSize).getMany()
      : await ordered.take(effectivePageSize).getMany();
    const cities = await this.cityRepo.findBy({ id: In([...new Set(items.map((item) => item.cityId))]) });
    const names = new Map(cities.map((city) => [city.id, city.name]));
    return { items: items.map((item) => ({ ...item, cityName: names.get(item.cityId) })), total, page, pageSize: effectivePageSize };
  }

  async listCategories(): Promise<BizCostCategoryEntity[]> {
    return this.categoryRepo.find({ where: { status: 'active' }, order: { sortOrder: 'ASC', name: 'ASC' } });
  }

  async detail(auth: BizAuthContext, id: string): Promise<BizCostEntryEntity> {
    const item = await this.getOrFail(id);
    await this.assertCityAccess(auth, item.cityId);
    return item;
  }

  // ================= 新增/编辑/提交/撤回 =================

  async create(auth: BizAuthContext, dto: CostEntryDto): Promise<BizCostEntryEntity> {
    const cityId = this.resolveCityId(auth, dto.cityId);
    await this.assertCityAccess(auth, cityId);
    await this.assertRules({ ...dto, cityId });
    const item = await this.costRepo.save({
      id: randomUUID(),
      cityId,
      businessMonth: dto.businessMonth,
      categoryCode: dto.categoryCode,
      amountFen: Math.round(dto.amountFen),
      description: dto.description ?? null,
      status: CostStatus.DRAFT,
      versionNo: 1,
    });
    await this.recordOp(auth.userId, 'cost.create', item.id);
    return item;
  }

  /**
   * 提交即生效（事务内版本）：供 saveMonthly 批量提交复用，
   * 保证「整月要么全部生效、要么全部不生效」，不会出现半套数据。
   * 返回 null 表示记录已不存在或状态不允许提交（调用方自行决定是否报错）。
   */
  private async submitInTx(manager: EntityManager, auth: BizAuthContext, id: string): Promise<BizCostEntryEntity | null> {
    const repo = manager.getRepository(BizCostEntryEntity);
    const opRepo = manager.getRepository(BizOperationLogEntity);
    const item = await repo.findOneBy({ id });
    if (!item) return null;
    if (item.status !== CostStatus.DRAFT && item.status !== CostStatus.REJECTED) return null;
    await this.assertRules({
      cityId: item.cityId, businessMonth: item.businessMonth,
      categoryCode: item.categoryCode, amountFen: Number(item.amountFen), description: item.description,
    });
    // 提交即生效，不再进入待审核队列；保留 pending 仅用于兼容历史记录。
    item.status = CostStatus.APPROVED;
    item.submittedBy = auth.userId;
    item.submittedAt = new Date();
    item.reviewerId = auth.userId;
    item.reviewedAt = new Date();
    item.reviewComment = null;
    const saved = await repo.save(item);
    await opRepo.save({ id: randomUUID(), operatorUserId: auth.userId, actionType: 'cost.submit', targetType: 'cost_entry', targetId: id, resultStatus: 'success' });
    return saved;
  }

  /**
   * 月度批量填报：先全量校验，再在单个事务内落库 + 按需提交。
   * 修复点：① 原先逐条 save 无事务，中途校验失败会让前几条已落库；
   *         ② 原先遇到已生效记录直接 continue，用户填的金额被静默丢弃且无任何提示。
   */
  async saveMonthly(auth: BizAuthContext, dto: MonthlyCostDto): Promise<{ items: BizCostEntryEntity[]; skipped: Array<{ categoryCode: string; status: string; reason: string }> }> {
    const cityId = this.resolveCityId(auth, dto.cityId);
    if (!/^\d{4}-\d{2}$/.test(dto.businessMonth)) throw new BadRequestException('业务月份格式应为 YYYY-MM');
    const categories = await this.listCategories();
    const validCodes = new Set(categories.map((category) => category.code));
    const entries = dto.entries ?? [];
    await this.assertCityAccess(auth, cityId);

    // 1) 先做全量校验：任一条不合法都整体拒绝，不落任何数据
    const plan: Array<{ categoryCode: string; amountFen: number; description: string | null }> = [];
    for (const entry of entries) {
      const amountFen = Number(entry.amountFen ?? 0);
      if (!Number.isFinite(amountFen) || amountFen < 0) throw new BadRequestException('金额不能小于 0');
      if (amountFen === 0 && !String(entry.description ?? '').trim()) continue;
      if (!validCodes.has(entry.categoryCode)) throw new BadRequestException(`成本分类不存在：${entry.categoryCode}`);
      await this.assertRules({ cityId, businessMonth: dto.businessMonth, categoryCode: entry.categoryCode, amountFen, description: entry.description ?? null });
      plan.push({ categoryCode: entry.categoryCode, amountFen, description: entry.description ?? null });
    }
    if (plan.length === 0) return { items: [], skipped: [] };

    // 2) 单事务落库（+ 可选提交），任一步失败整体回滚
    const skipped: Array<{ categoryCode: string; status: string; reason: string }> = [];
    const saved = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(BizCostEntryEntity);
      const opRepo = manager.getRepository(BizOperationLogEntity);
      const out: BizCostEntryEntity[] = [];
      for (const item of plan) {
        const existing = await repo.find({ where: { cityId, businessMonth: dto.businessMonth, categoryCode: item.categoryCode }, order: { updatedAt: 'DESC' }, take: 1 });
        const editable = existing[0];
        if (editable && ![CostStatus.DRAFT, CostStatus.REJECTED].includes(editable.status as CostStatus)) {
          // 不可覆盖：显式记录并返回给前端提示，不再静默丢弃
          skipped.push({ categoryCode: item.categoryCode, status: String(editable.status), reason: '该分类已有生效中/审核中/已作废记录，本次金额未保存' });
          continue;
        }
        if (editable) {
          Object.assign(editable, { amountFen: Math.round(item.amountFen), description: item.description });
          const updated = await repo.save(editable);
          out.push(updated);
          await opRepo.save({ id: randomUUID(), operatorUserId: auth.userId, actionType: 'cost.update', targetType: 'cost_entry', targetId: updated.id, resultStatus: 'success' });
        } else {
          const created = await repo.save({
            id: randomUUID(), cityId, businessMonth: dto.businessMonth, categoryCode: item.categoryCode,
            amountFen: Math.round(item.amountFen), description: item.description,
            status: CostStatus.DRAFT, versionNo: 1,
          });
          out.push(created);
          await opRepo.save({ id: randomUUID(), operatorUserId: auth.userId, actionType: 'cost.create', targetType: 'cost_entry', targetId: created.id, resultStatus: 'success' });
        }
      }
      if (dto.submit) {
        const submitted: BizCostEntryEntity[] = [];
        for (const item of out) {
          const result = await this.submitInTx(manager, auth, item.id);
          if (result) submitted.push(result);
        }
        return submitted.length ? submitted : out;
      }
      return out;
    });
    const cityIds = [...new Set(saved.map((item) => item.cityId))];
    for (const id of cityIds) void this.aggregates.recalcInternal({ cityId: id }).catch(() => {});
    return { items: saved, skipped };
  }

  async update(auth: BizAuthContext, id: string, dto: Partial<CostEntryDto>): Promise<BizCostEntryEntity> {
    const item = await this.getOrFail(id);
    await this.assertCityAccess(auth, item.cityId);
    if (item.status !== CostStatus.DRAFT && item.status !== CostStatus.REJECTED) throw new BadRequestException('仅草稿或已退回记录可编辑');
    const merged: CostEntryDto & { cityId: string } = {
      cityId: this.resolveCityId(auth, dto.cityId ?? item.cityId),
      businessMonth: dto.businessMonth ?? item.businessMonth,
      categoryCode: dto.categoryCode ?? item.categoryCode,
      amountFen: dto.amountFen ?? Number(item.amountFen),
      description: dto.description ?? item.description,
    };
    await this.assertRules(merged);
    // 新 cityId 范围校验（update 允许改城市时，新城市必须在操作人数据范围内）
    if (merged.cityId !== item.cityId) await this.assertCityAccess(auth, merged.cityId);
    Object.assign(item, {
      cityId: merged.cityId,
      businessMonth: merged.businessMonth,
      categoryCode: merged.categoryCode,
      amountFen: Math.round(merged.amountFen),
      description: merged.description,
    });
    try {
      await this.costRepo.save(item);
    } catch (error) {
      rethrowOptimisticLock(error);
    }
    await this.recordOp(auth.userId, 'cost.update', id);
    return item;
  }

  async submit(auth: BizAuthContext, id: string): Promise<BizCostEntryEntity> {
    const item = await this.getOrFail(id);
    await this.assertCityAccess(auth, item.cityId);
    const saved = await this.dataSource.transaction((manager) => this.submitInTx(manager, auth, id));
    if (!saved) throw new BadRequestException('仅草稿或已退回记录可提交');
    void this.aggregates.recalcInternal({ cityId: saved.cityId }).catch(() => {});
    return saved;
  }

  /**
   * 撤回：把记录打回草稿。
   * 兼容两种状态机：历史 pending 记录；以及「提交即生效」后由提交人本人（或超管）反悔的 approved 记录
   * —— 否则 submit 直接置 approved 会让 withdraw 永远报「仅已提交记录可撤回」。
   * 撤回已生效记录会触发经营重算，保证统计与明细一致。
   */
  async withdraw(auth: BizAuthContext, id: string): Promise<BizCostEntryEntity> {
    const item = await this.getOrFail(id);
    await this.assertCityAccess(auth, item.cityId);
    if (item.status !== CostStatus.PENDING && item.status !== CostStatus.APPROVED) {
      throw new BadRequestException('仅已提交或已生效记录可撤回');
    }
    if (!auth.isSuperAdmin && item.submittedBy !== auth.userId) throw new ForbiddenException('仅提交人可撤回');
    const wasEffective = item.status === CostStatus.APPROVED;
    item.status = CostStatus.DRAFT;
    item.submittedBy = null;
    item.submittedAt = null;
    try {
      await this.costRepo.save(item); // 乐观锁
    } catch (error) {
      rethrowOptimisticLock(error);
    }
    await this.recordOp(auth.userId, 'cost.withdraw', id);
    if (wasEffective) void this.aggregates.recalcInternal({ cityId: item.cityId }).catch(() => {});
    return item;
  }

  // ================= 审核（DEV-043：权限由守卫校验 operation.cost.approve） =================

  async approve(auth: BizAuthContext, id: string): Promise<BizCostEntryEntity> {
    const item = await this.getOrFail(id);
    await this.assertCityAccess(auth, item.cityId);
    if (item.status !== CostStatus.PENDING) throw new BadRequestException('仅历史待审核记录可审核');
    item.status = CostStatus.APPROVED;
    item.reviewerId = auth.userId;
    item.reviewedAt = new Date();
    item.reviewComment = null;
    try {
      await this.costRepo.save(item);
    } catch (error) {
      rethrowOptimisticLock(error);
    }
    await this.recordOp(auth.userId, 'cost.approve', id);
    void this.aggregates.recalcInternal({ cityId: item.cityId }).catch(() => {});
    return item;
  }

  async reject(auth: BizAuthContext, id: string, comment: string): Promise<BizCostEntryEntity> {
    const item = await this.getOrFail(id);
    await this.assertCityAccess(auth, item.cityId);
    if (item.status !== CostStatus.PENDING && item.status !== CostStatus.APPROVED) throw new BadRequestException('仅待审核或已生效记录可退回');
    if (!comment?.trim()) throw new BadRequestException('驳回原因必填');
    item.status = CostStatus.REJECTED;
    item.reviewerId = auth.userId;
    item.reviewedAt = new Date();
    item.reviewComment = comment.trim().slice(0, 500);
    try {
      await this.costRepo.save(item);
    } catch (error) {
      rethrowOptimisticLock(error);
    }
    await this.recordOp(auth.userId, 'cost.reject', id);
    void this.aggregates.recalcInternal({ cityId: item.cityId }).catch(() => {});
    return item;
  }

  async returnMonthly(auth: BizAuthContext, dto: MonthlyReturnDto): Promise<{ items: BizCostEntryEntity[] }> {
    if (!dto.cityId || !/^\d{4}-\d{2}$/.test(dto.businessMonth)) throw new BadRequestException('地市和业务月份必填');
    if (!dto.comment?.trim()) throw new BadRequestException('退回原因必填');
    await this.assertCityAccess(auth, dto.cityId);
    const returned = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(BizCostEntryEntity);
      const opRepo = manager.getRepository(BizOperationLogEntity);
      const items = await repo.find({ where: { cityId: dto.cityId, businessMonth: dto.businessMonth, status: CostStatus.APPROVED }, order: { categoryCode: 'ASC' } });
      if (!items.length) throw new BadRequestException('该地市该月份没有已生效成本');
      const comment = dto.comment.trim().slice(0, 500);
      for (const item of items) {
        item.status = CostStatus.REJECTED;
        item.reviewerId = auth.userId;
        item.reviewedAt = new Date();
        item.reviewComment = comment;
        await repo.save(item);
        await opRepo.save({ id: randomUUID(), operatorUserId: auth.userId, actionType: 'cost.monthly_return', targetType: 'cost_entry', targetId: item.id, resultStatus: 'success' });
      }
      return items;
    });
    void this.aggregates.recalcInternal({ cityId: dto.cityId }).catch(() => {});
    return { items: returned };
  }

  async voidItem(auth: BizAuthContext, id: string, reason: string): Promise<BizCostEntryEntity> {
    const item = await this.getOrFail(id);
    await this.assertCityAccess(auth, item.cityId);
    if (item.status !== CostStatus.APPROVED) throw new BadRequestException('仅已审核通过的记录可作废');
    if (!reason?.trim()) throw new BadRequestException('作废原因必填');
    item.status = CostStatus.VOIDED;
    item.voidedBy = auth.userId;
    item.voidedAt = new Date();
    item.voidReason = reason.trim().slice(0, 255);
    try {
      await this.costRepo.save(item);
    } catch (error) {
      rethrowOptimisticLock(error);
    }
    await this.recordOp(auth.userId, 'cost.void', id);
    void this.aggregates.recalcInternal({ cityId: item.cityId }).catch(() => {});
    return item;
  }

  async restoreItem(auth: BizAuthContext, id: string): Promise<BizCostEntryEntity> {
    const item = await this.getOrFail(id);
    await this.assertCityAccess(auth, item.cityId);
    if (item.status !== CostStatus.VOIDED) throw new BadRequestException('仅已作废记录可恢复');
    item.status = CostStatus.APPROVED;
    item.voidedBy = null;
    item.voidedAt = null;
    item.voidReason = null;
    try {
      await this.costRepo.save(item);
    } catch (error) {
      rethrowOptimisticLock(error);
    }
    await this.recordOp(auth.userId, 'cost.restore', id);
    void this.aggregates.recalcInternal({ cityId: item.cityId }).catch(() => {});
    return item;
  }
}
