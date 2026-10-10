import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, In } from 'typeorm';
import { ContractEntity } from './contract.entity';
import { AllocationEntity } from './allocation.entity';
import { ContractCityBusinessMetricEntity } from './contract-city-business-metric.entity';
import { CityEntity } from '../cities/city.entity';
import { SoftDeleteFlag } from '@biz-reporting/shared-types';
import type {
  CreateContractRequest,
  UpdateContractRequest,
  CreateAllocationRequest,
  UpdateAllocationRequest,
  PaginatedResponse,
  PaginationParams,
} from '@biz-reporting/shared-types';

/**
 * 合同管理核心服务
 *
 * 职责:
 * - 合同 CRUD + 软删除
 * - 合同跨地市分配管理（CRUD）+ 经营测算指标联动
 * - 分页查询 + 搜索
 *
 * 一致性保证:
 * - allocation + business metrics 写入全部使用 DataSource.transaction()
 * - 禁止分离写入
 *
 * TODO (后续 WS):
 * - 导入/导出 Excel
 * - 累计金额自动同步逻辑
 */
@Injectable()
export class ContractsService {
  constructor(
    @InjectRepository(ContractEntity)
    private readonly contractRepository: Repository<ContractEntity>,
    @InjectRepository(AllocationEntity)
    private readonly allocationRepository: Repository<AllocationEntity>,
    @InjectRepository(ContractCityBusinessMetricEntity)
    private readonly metricRepository: Repository<ContractCityBusinessMetricEntity>,
    @InjectRepository(CityEntity)
    private readonly cityRepository: Repository<CityEntity>,
    private readonly dataSource: DataSource,
  ) {}

  // ============================================================
  // 合同 CRUD
  // ============================================================

  /**
   * 分页查询合同列表（排除软删除）
   */
  async list(params: PaginationParams): Promise<PaginatedResponse<ReturnType<ContractsService['toContractDTO']> & { cities: Array<{ cityId: number; cityName: string }> }>> {
    const page = params.page || 1;
    const pageSize = params.pageSize || 20;
    const keyword = (params as { keyword?: string }).keyword; // 可选搜索关键词

    const qb = this.contractRepository.createQueryBuilder('c')
      .where('c.is_deleted = :deleted', { deleted: SoftDeleteFlag.NOT_DELETED });

    if (keyword) {
      qb.andWhere(
        '(c.contract_code LIKE :kw OR c.contract_name LIKE :kw)',
        { kw: `%${keyword}%` },
      );
    }

    const [items, total] = await qb
      .orderBy('c.created_at', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    // 批量查询城市分配，按 contractId 分组
    const contractIds = items.map((c) => c.id);
    const allocs = contractIds.length > 0
      ? await this.allocationRepository.find({ where: { contractId: In(contractIds) } })
      : [];
    const cityIds = [...new Set(allocs.map((a) => Number(a.cityId)))];
    const cities = cityIds.length > 0
      ? await this.cityRepository.find({ where: { id: In(cityIds) } })
      : [];
    const cityNameMap = new Map(cities.map((c) => [c.id, c.name]));
    const allocMap = new Map<number, Array<{ cityId: number; cityName: string }>>();
    for (const a of allocs) {
      const list = allocMap.get(a.contractId) || [];
      list.push({ cityId: a.cityId, cityName: cityNameMap.get(Number(a.cityId)) || `城市#${a.cityId}` });
      allocMap.set(a.contractId, list);
    }

    return {
      items: items.map((c) => ({
        ...this.toContractDTO(c),
        cities: allocMap.get(c.id) || [],
      })),
      total,
      page,
      pageSize,
    };
  }

  /** 查找单个合同（含城市分配列表及经营测算指标） */
  /** ?????????????????????? */
  async findOne(id: number) {
    const contract = await this.withTransientDbRetry(
      () => this.contractRepository.findOne({
        where: { id, isDeleted: SoftDeleteFlag.NOT_DELETED },
      }),
      `Contract #${id} main query`,
    );
    if (!contract) {
      throw new NotFoundException(`?? #${id} ???`);
    }

    // ?? allocations + business metrics
    const allocations = await this.withTransientDbRetry(
      () => this.listAllocations(id),
      `Contract #${id} allocations query`,
    );

    return {
      ...this.toContractDTO(contract),
      allocations,
    };
  }
  async create(dto: CreateContractRequest, userId?: number): Promise<ReturnType<ContractsService['toContractDTO']>> {
    // 检查合同编码唯一性
    const existing = await this.contractRepository.findOne({
      where: { contractCode: dto.contractCode },
    });
    if (existing && !existing.isDeleted) {
      throw new BadRequestException(`合同编码 ${dto.contractCode} 已存在`);
    }

    const uid = userId ?? 0;
    const contract = this.contractRepository.create({
      contractCode: dto.contractCode,
      contractName: dto.contractName,
      contractAmount: dto.contractAmount,
      rate: dto.rate || 0,
      signDate: dto.signDate || null,
      expireDate: dto.expireDate || null,
      isDeleted: SoftDeleteFlag.NOT_DELETED,
      createdBy: uid,
      updatedBy: uid,
    });

    const saved = await this.contractRepository.save(contract);
    return this.toContractDTO(saved);
  }

  /** 更新合同信息 */
  async update(id: number, dto: UpdateContractRequest, userId?: number): Promise<ReturnType<ContractsService['toContractDTO']>> {
    const contract = await this.findOrThrow(id);

    // 更新可变字段
    if (dto.contractName !== undefined) contract.contractName = dto.contractName;
    if (dto.contractAmount !== undefined) contract.contractAmount = dto.contractAmount;
    if (dto.rate !== undefined) contract.rate = dto.rate;
    if (dto.signDate !== undefined) contract.signDate = typeof dto.signDate === 'string' ? new Date(dto.signDate) : dto.signDate;
    if (dto.expireDate !== undefined) contract.expireDate = typeof dto.expireDate === 'string' ? new Date(dto.expireDate) : dto.expireDate;

    if (userId !== undefined) contract.updatedBy = userId;

    const saved = await this.contractRepository.save(contract);
    return this.toContractDTO(saved);
  }

  /**
   * 软删除合同
   *
   * 关键业务规则:
   * - 仅标记 is_deleted=1 + deleted_at
   * - 不删除物理数据，已有月度快照中的快照数据不受影响
   */
  async softDelete(id: number, userId?: number): Promise<{ success: boolean; message: string }> {
    const contract = await this.findOrThrow(id);

    if (contract.isDeleted === SoftDeleteFlag.DELETED) {
      throw new BadRequestException('该合同已被软删除');
    }

    await this.contractRepository.update(id, {
      isDeleted: SoftDeleteFlag.DELETED,
      deletedAt: new Date(),
      updatedBy: userId ?? contract.updatedBy,
    });

    return { success: true, message: `合同 ${contract.contractCode} 已软删除，历史快照不受影响` };
  }

  /** [危险] 物理清除所有合同、分配、经营测算指标 */
  async purgeAll(): Promise<{ success: boolean; message: string }> {
    throw new ForbiddenException('Physical deletion is disabled');
    try {
      // 逐表删除（TypeORM delete({}) 不支持空条件，用 queryBuilder）
      await this.metricRepository.createQueryBuilder().delete().execute();
      void this.allocationRepository;
      void this.contractRepository;
      return { success: true, message: '所有合同及相关数据已物理清除' };
    } catch (err: unknown) {
      const msg = String(err);
      throw new Error(msg);
    }
  }

  // ============================================================
  // 分配管理
  // ============================================================

  /** 获取指定合同的所有城市分配 */
  async listAllocations(contractId: number): Promise<Array<ReturnType<ContractsService['toAllocationDTO']>>> {
    await this.findOrThrow(contractId); // 校验合同存在

    const allocations = await this.allocationRepository.find({
      where: { contractId },
      order: { cityId: 'ASC' },
    });

    // 联查 business metrics
    const allocationIds = allocations.map((a) => a.id);
    const metrics = allocationIds.length > 0
      ? await this.metricRepository.find({
        where: { contractCityAllocationId: In(allocationIds) },
      })
      : [];
    const metricMap = new Map(metrics.map((m) => [m.contractCityAllocationId, m]));

    return allocations.map((a) => this.toAllocationDTO(a, metricMap.get(a.id) ?? null));
  }

  /** 新增城市分配（事务化：allocation + metrics 要么都成功要么都失败） */
  async createAllocation(dto: CreateAllocationRequest): Promise<ReturnType<ContractsService['toAllocationDTO']>> {
    // 校验合同存在且未删除（事务外校验，不阻塞一次事务）
    await this.findOrThrow(dto.contractId);

    return this.dataSource.transaction(async (manager) => {
      const allocRepo = manager.getRepository(AllocationEntity);
      const metricRepo = manager.getRepository(ContractCityBusinessMetricEntity);

      // 检查唯一约束
      const existing = await allocRepo.findOne({
        where: { contractId: dto.contractId, cityId: dto.cityId },
      });
      if (existing) {
        throw new BadRequestException(
          `该合同已分配给城市 #${dto.cityId}`,
        );
      }

      // 创建 allocation
      const alloc = allocRepo.create({
        contractId: dto.contractId,
        cityId: dto.cityId,
        cityContractAmount: dto.cityContractAmount || 0,
        rate: dto.rate || 0,
      });
      const saved = await allocRepo.save(alloc);

      // 创建对应的 business metrics
      const metric = metricRepo.create({
        contractCityAllocationId: saved.id,
        estimatedOrderAmount2026: Number(dto.estimatedOrderAmount2026 || 0),
        estimatedIncomeAmount2026: Number(dto.estimatedIncomeAmount2026 || 0),
        remark: dto.remark || null,
        sourceCityName: dto.sourceCityName || null,
      });
      const savedMetric = await metricRepo.save(metric);

      return this.toAllocationDTO(saved, savedMetric);
    });
  }

  /** 更新分配信息（事务化：allocation + metrics 强一致） */
  async updateAllocation(id: number, dto: UpdateAllocationRequest): Promise<ReturnType<ContractsService['toAllocationDTO']>> {
    return this.dataSource.transaction(async (manager) => {
      const allocRepo = manager.getRepository(AllocationEntity);
      const metricRepo = manager.getRepository(ContractCityBusinessMetricEntity);

      const alloc = await allocRepo.findOne({ where: { id } });
      if (!alloc) {
        throw new NotFoundException(`分配记录 #${id} 不存在`);
      }

      if (dto.cityContractAmount !== undefined) alloc.cityContractAmount = dto.cityContractAmount;
      if (dto.rate !== undefined) alloc.rate = dto.rate;

      const saved = await allocRepo.save(alloc);

      // 同步更新 business metrics（有则 update，无则 create）
      let metric = await metricRepo.findOne({
        where: { contractCityAllocationId: id },
      });

      const metricData = {
        estimatedOrderAmount2026: dto.estimatedOrderAmount2026 !== undefined
          ? Number(dto.estimatedOrderAmount2026 || 0)
          : (metric?.estimatedOrderAmount2026 ?? 0),
        estimatedIncomeAmount2026: dto.estimatedIncomeAmount2026 !== undefined
          ? Number(dto.estimatedIncomeAmount2026 || 0)
          : (metric?.estimatedIncomeAmount2026 ?? 0),
        remark: dto.remark !== undefined ? (dto.remark || null) : (metric?.remark ?? null),
        sourceCityName: dto.sourceCityName !== undefined ? (dto.sourceCityName || null) : (metric?.sourceCityName ?? null),
      };

      if (metric) {
        await metricRepo.update(metric.id, metricData);
        metric = { ...metric, ...metricData };
      } else {
        metric = metricRepo.create({
          contractCityAllocationId: id,
          ...metricData,
        });
        metric = await metricRepo.save(metric);
      }

      return this.toAllocationDTO(saved, metric);
    });
  }

  /** 删除分配记录（事务化：先删 metrics，再删 allocation，无孤儿数据） */
  async deleteAllocation(id: number): Promise<{ success: boolean }> {
    return this.dataSource.transaction(async (manager) => {
      const allocRepo = manager.getRepository(AllocationEntity);
      const metricRepo = manager.getRepository(ContractCityBusinessMetricEntity);

      const alloc = await allocRepo.findOne({ where: { id } });
      if (!alloc) {
        throw new NotFoundException(`分配记录 #${id} 不存在`);
      }

      // 先删 business metrics
      await metricRepo.delete({ contractCityAllocationId: id });
      // 再删 allocation
      await allocRepo.remove(alloc);

      return { success: true };
    });
  }

  // ============================================================
  // 内部方法
  // ============================================================

  private async findOrThrow(id: number): Promise<ContractEntity> {
    const contract = await this.contractRepository.findOne({ where: { id } });
    if (!contract) {
      throw new NotFoundException(`合同 #${id} 不存在`);
    }
    return contract;
  }

  private async findAllocationOrThrow(id: number): Promise<AllocationEntity> {
    const alloc = await this.allocationRepository.findOne({ where: { id } });
    if (!alloc) {
      throw new NotFoundException(`分配记录 #${id} 不存在`);
    }
    return alloc;
  }

  /** Entity → DTO 映射（隐藏内部字段） */
  private toContractDTO(c: ContractEntity) {
    return {
      id: c.id,
      contractCode: c.contractCode,
      contractName: c.contractName,
      contractAmount: c.contractAmount,
      rate: c.rate,
      accumulatedOrderAmount: c.accumulatedOrderAmount,
      accumulatedInvoiceAmount: c.accumulatedInvoiceAmount,
      signDate: c.signDate,
      expireDate: c.expireDate,
      isDeleted: c.isDeleted === SoftDeleteFlag.DELETED,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }

  private toAllocationDTO(a: AllocationEntity, metric?: ContractCityBusinessMetricEntity | null) {
    return {
      id: a.id,
      contractId: a.contractId,
      cityId: a.cityId,
      cityContractAmount: a.cityContractAmount,
      rate: a.rate,
      accumulatedOrderAmount: a.accumulatedOrderAmount,
      accumulatedInvoiceAmount: a.accumulatedInvoiceAmount,
      estimatedOrderAmount2026: metric?.estimatedOrderAmount2026 ?? 0,
      estimatedIncomeAmount2026: metric?.estimatedIncomeAmount2026 ?? 0,
      remark: metric?.remark ?? null,
      sourceCityName: metric?.sourceCityName ?? null,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    };
  }

  private async withTransientDbRetry<T>(
    operation: () => Promise<T>,
    context: string,
    maxRetries = 1,
  ): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (attempt >= maxRetries || !this.isTransientDbError(error)) {
          throw error;
        }

        const message = this.getErrorMessage(error);
        console.warn(`[ContractsService] retrying ${context} after transient DB error: ${message}`);
        await this.delay(150 * (attempt + 1));
      }
    }

    throw new Error(`${context} failed after retry`);
  }

  private isTransientDbError(error: unknown): boolean {
    const message = this.getErrorMessage(error).toLowerCase();
    return (
      message.includes('econnreset') ||
      message.includes('malformed communication packet') ||
      message.includes('protocol') ||
      message.includes('connection lost') ||
      message.includes('read eof') ||
      message.includes('deadlock found') ||
      message.includes('lock wait timeout exceeded')
    );
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === "object" && error !== null) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === "string") {
        return message;
      }
    }

    return String(error);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
