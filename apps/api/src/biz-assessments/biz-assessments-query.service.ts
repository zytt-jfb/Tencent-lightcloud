import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, SelectQueryBuilder, Repository } from 'typeorm';
import { AssessmentRecordEntity } from './assessment-record.entity';
import { CityEntity } from '../main-data/city.entity';
import { BizAuthContext } from '../rbac/rbac.service';

/** 计入概览的状态：导入行 active、线下填报已提交 */
export const EFFECTIVE_ASSESSMENT_STATUSES = ['active', 'submitted'] as const;

export interface AssessmentQueryFilter {
  months?: string[];
  year?: string;
  cityIds?: string[];
  supplierName?: string;
  projectName?: string;
  evalMethod?: string;
  source?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export interface AssessmentOverviewRow {
  id: string;
  source: 'import' | 'offline';
  evalMonth: string;
  projectName: string;
  cityId: string | null;
  cityName: string;
  supplierName: string;
  contractId: string | null;
  contractNo: string | null;
  score: number;
  grade: string | null;
  evalMethod: 'online' | 'offline';
  status: string;
  returnedBy: string | null;
  returnReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AssessmentSummary {
  totalCount: number;
  supplierCount: number;
  cityCount: number;
  projectCount: number;
  avgScore: number;
  maxScore: number;
  minScore: number;
  onlineCount: number;
  offlineCount: number;
  importedCount: number;
  entryCount: number;
  months: Array<{ month: string; count: number; avgScore: number }>;
  cities: Array<{ cityId: string | null; cityName: string; count: number; avgScore: number; minScore: number }>;
  suppliers: Array<{ supplierName: string; count: number; avgScore: number; minScore: number }>;
  distribution: Array<{ bucket: string; count: number }>;
}

const DISTRIBUTION_BUCKETS: Array<{ bucket: string; test: (score: number) => boolean }> = [
  { bucket: '100', test: (score) => score >= 100 },
  { bucket: '95-99.99', test: (score) => score >= 95 && score < 100 },
  { bucket: '90-94.99', test: (score) => score >= 90 && score < 95 },
  { bucket: '80-89.99', test: (score) => score >= 80 && score < 90 },
  { bucket: '60-79.99', test: (score) => score >= 60 && score < 80 },
  { bucket: '60以下', test: (score) => score < 60 },
];

/** 数字归一：TypeORM 的 decimal 在 MySQL 驱动下返回字符串 */
function toNumber(value: unknown): number {
  const num = Number(value ?? 0);
  return Number.isFinite(num) ? Math.round(num * 100) / 100 : 0;
}

/**
 * 后评估概览查询（工程管理 / 后评估管理）
 * 口径：
 *  - 默认只统计「已生效」行（导入 active + 线下已提交 submitted），草稿/退回/作废不计入
 *  - 所有查询强制套用账号数据范围：地市账号只能看本地市
 *  - 分数为 0-100 的 DECIMAL(6,2)，出参统一转 number，避免前端拿到字符串
 */
@Injectable()
export class BizAssessmentsQueryService {
  constructor(
    @InjectRepository(AssessmentRecordEntity) private readonly recordRepo: Repository<AssessmentRecordEntity>,
    @InjectRepository(CityEntity) private readonly cityRepo: Repository<CityEntity>,
  ) {}

  /** 套用数据范围：city_id 维度 */
  private async applyScope(qb: SelectQueryBuilder<AssessmentRecordEntity>, auth: BizAuthContext, alias = 'r'): Promise<SelectQueryBuilder<AssessmentRecordEntity>> {
    const scope = auth.dataScope;
    if (auth.isSuperAdmin || scope.scopeType === 'all' || scope.allowAll) return qb;
    const scopedCityIds = new Set<string>(scope.cityIds ?? []);
    if (scope.cityId) scopedCityIds.add(scope.cityId);
    if (scopedCityIds.size > 0) {
      qb.andWhere(`${alias}.cityId IN (:...scopeCityIds)`, { scopeCityIds: [...scopedCityIds] });
      return qb;
    }
    if (scope.provinceIds.length > 0) {
      const cities = await this.cityRepo.find({ where: { provinceId: In(scope.provinceIds) } });
      const ids = cities.map((city) => city.id);
      if (ids.length === 0) qb.andWhere('1 = 0');
      else qb.andWhere(`${alias}.cityId IN (:...scopeCityIds)`, { scopeCityIds: ids });
      return qb;
    }
    // contract / none 范围没有后评估数据
    qb.andWhere('1 = 0');
    return qb;
  }

  private applyFilter(qb: SelectQueryBuilder<AssessmentRecordEntity>, filter: AssessmentQueryFilter, alias = 'r'): SelectQueryBuilder<AssessmentRecordEntity> {
    if (!filter.status) qb.andWhere(`${alias}.status IN (:...effectiveStatuses)`, { effectiveStatuses: [...EFFECTIVE_ASSESSMENT_STATUSES] });
    else qb.andWhere(`${alias}.status = :status`, { status: filter.status });
    if (filter.months?.length) qb.andWhere(`${alias}.evalMonth IN (:...months)`, { months: filter.months });
    if (filter.year && /^\d{4}$/.test(filter.year)) qb.andWhere(`${alias}.evalMonth LIKE :yearLike`, { yearLike: `${filter.year}-%` });
    if (filter.cityIds?.length) qb.andWhere(`${alias}.cityId IN (:...filterCityIds)`, { filterCityIds: filter.cityIds });
    if (filter.supplierName?.trim()) qb.andWhere(`${alias}.supplierName LIKE :supplierLike`, { supplierLike: `%${filter.supplierName.trim()}%` });
    if (filter.projectName?.trim()) qb.andWhere(`${alias}.projectName LIKE :projectLike`, { projectLike: `%${filter.projectName.trim()}%` });
    if (filter.evalMethod) qb.andWhere(`${alias}.evalMethod = :evalMethod`, { evalMethod: filter.evalMethod });
    if (filter.source) qb.andWhere(`${alias}.source = :source`, { source: filter.source });
    return qb;
  }

  private toRow(entity: AssessmentRecordEntity): AssessmentOverviewRow {
    return {
      id: entity.id,
      source: entity.source,
      evalMonth: entity.evalMonth,
      projectName: entity.projectName,
      cityId: entity.cityId,
      cityName: entity.cityName,
      supplierName: entity.supplierName,
      contractId: entity.contractId,
      contractNo: entity.contractNo,
      score: toNumber(entity.score),
      grade: entity.grade,
      evalMethod: entity.evalMethod,
      status: entity.status,
      returnedBy: entity.returnedBy,
      returnReason: entity.returnReason,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  async list(auth: BizAuthContext, filter: AssessmentQueryFilter): Promise<{ items: AssessmentOverviewRow[]; total: number; page: number; pageSize: number }> {
    const page = Math.max(1, Number(filter.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(filter.pageSize) || 20));
    const qb = this.recordRepo.createQueryBuilder('r');
    await this.applyScope(qb, auth, 'r');
    this.applyFilter(qb, filter, 'r');
    const [entities, total] = await qb
      .orderBy('r.evalMonth', 'DESC')
      .addOrderBy('r.cityName', 'ASC')
      .addOrderBy('r.supplierName', 'ASC')
      .addOrderBy('r.projectName', 'ASC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();
    return { items: entities.map((entity) => this.toRow(entity)), total, page, pageSize };
  }

  /** 导出用：不翻页，硬上限 20000 行 */
  async listAll(auth: BizAuthContext, filter: AssessmentQueryFilter): Promise<AssessmentOverviewRow[]> {
    const qb = this.recordRepo.createQueryBuilder('r');
    await this.applyScope(qb, auth, 'r');
    this.applyFilter(qb, filter, 'r');
    const entities = await qb
      .orderBy('r.evalMonth', 'DESC')
      .addOrderBy('r.cityName', 'ASC')
      .addOrderBy('r.supplierName', 'ASC')
      .take(20000)
      .getMany();
    return entities.map((entity) => this.toRow(entity));
  }

  /** 概览指标：全部在内存聚合（单月数据量百级，SQL 聚合不划算且口径难复用） */
  async summary(auth: BizAuthContext, filter: AssessmentQueryFilter): Promise<AssessmentSummary> {
    const rows = await this.listAll(auth, filter);
    const totalCount = rows.length;
    const scoreSum = rows.reduce((sum, row) => sum + row.score, 0);
    const supplierSet = new Set(rows.map((row) => row.supplierName));
    const projectSet = new Set(rows.map((row) => row.projectName));
    const citySet = new Set(rows.map((row) => row.cityId ?? row.cityName).filter(Boolean));

    const monthMap = new Map<string, { count: number; sum: number }>();
    const cityMap = new Map<string, { cityId: string | null; cityName: string; count: number; sum: number; min: number }>();
    const supplierMap = new Map<string, { count: number; sum: number; min: number }>();
    const distribution = DISTRIBUTION_BUCKETS.map((item) => ({ bucket: item.bucket, count: 0 }));

    for (const row of rows) {
      const month = monthMap.get(row.evalMonth) ?? { count: 0, sum: 0 };
      month.count += 1; month.sum += row.score;
      monthMap.set(row.evalMonth, month);

      const cityKey = row.cityId ?? row.cityName ?? '未匹配地市';
      const city = cityMap.get(cityKey) ?? { cityId: row.cityId, cityName: row.cityName || '未匹配地市', count: 0, sum: 0, min: row.score };
      city.count += 1; city.sum += row.score; city.min = Math.min(city.min, row.score);
      cityMap.set(cityKey, city);

      const supplier = supplierMap.get(row.supplierName) ?? { count: 0, sum: 0, min: row.score };
      supplier.count += 1; supplier.sum += row.score; supplier.min = Math.min(supplier.min, row.score);
      supplierMap.set(row.supplierName, supplier);

      const bucketIndex = DISTRIBUTION_BUCKETS.findIndex((item) => item.test(row.score));
      if (bucketIndex >= 0) distribution[bucketIndex].count += 1;
    }

    const round = (value: number) => Math.round(value * 100) / 100;
    return {
      totalCount,
      supplierCount: supplierSet.size,
      cityCount: citySet.size,
      projectCount: projectSet.size,
      avgScore: totalCount === 0 ? 0 : round(scoreSum / totalCount),
      maxScore: totalCount === 0 ? 0 : Math.max(...rows.map((row) => row.score)),
      minScore: totalCount === 0 ? 0 : Math.min(...rows.map((row) => row.score)),
      onlineCount: rows.filter((row) => row.evalMethod === 'online').length,
      offlineCount: rows.filter((row) => row.evalMethod === 'offline').length,
      importedCount: rows.filter((row) => row.source === 'import').length,
      entryCount: rows.filter((row) => row.source === 'offline').length,
      months: [...monthMap.entries()]
        .map(([month, value]) => ({ month, count: value.count, avgScore: round(value.sum / value.count) }))
        .sort((a, b) => b.month.localeCompare(a.month)),
      cities: [...cityMap.values()]
        .map((city) => ({ cityId: city.cityId, cityName: city.cityName, count: city.count, avgScore: round(city.sum / city.count), minScore: round(city.min) }))
        .sort((a, b) => b.count - a.count || a.avgScore - b.avgScore),
      suppliers: [...supplierMap.entries()]
        .map(([supplierName, value]) => ({ supplierName, count: value.count, avgScore: round(value.sum / value.count), minScore: round(value.min) }))
        .sort((a, b) => b.count - a.count || a.avgScore - b.avgScore)
        .slice(0, 30),
      distribution,
    };
  }

  /** 筛选下拉选项：受数据范围约束，避免地市账号看到其他地市的名字 */
  async options(auth: BizAuthContext): Promise<{
    months: string[];
    suppliers: string[];
    cities: Array<{ id: string; name: string }>;
    projects: string[];
  }> {
    const qb = this.recordRepo.createQueryBuilder('r');
    await this.applyScope(qb, auth, 'r');
    const rows = await qb
      .select(['r.id', 'r.evalMonth', 'r.supplierName', 'r.projectName', 'r.cityId', 'r.cityName'])
      .where(`r.status IN (:...effectiveStatuses)`, { effectiveStatuses: [...EFFECTIVE_ASSESSMENT_STATUSES] })
      .take(20000)
      .getMany();

    const months = [...new Set(rows.map((row) => row.evalMonth))].sort().reverse();
    const suppliers = [...new Set(rows.map((row) => row.supplierName))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    const projects = [...new Set(rows.map((row) => row.projectName))].sort((a, b) => a.localeCompare(b, 'zh-CN')).slice(0, 500);
    const cityIndex = new Map<string, string>();
    for (const row of rows) {
      if (row.cityId) cityIndex.set(row.cityId, row.cityName || row.cityId);
    }
    return {
      months,
      suppliers,
      projects,
      cities: [...cityIndex.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')),
    };
  }
}
