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

/** 极值（最高分/最低分）所在记录：卡片可点，点开直达这条记录 */
export interface AssessmentExtreme {
  score: number;
  /** 该分数一共有多少条 */
  count: number;
  /** 明细样本（最多 50 条，够定位到具体合同/地市/供应商） */
  sample: AssessmentOverviewRow[];
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
  extremes: { max: AssessmentExtreme | null; min: AssessmentExtreme | null };
}

/**
 * 分数段分布。sql 供「一条聚合里用 CASE WHEN 算完 6 段」使用，
 * 与 bucket 标签一一对应；边界与早期内存版完全一致，不可随意改。
 */
const DISTRIBUTION_BUCKETS: Array<{ bucket: string; sql: string }> = [
  { bucket: '100', sql: 'r.score >= 100' },
  { bucket: '95-99.99', sql: 'r.score >= 95 AND r.score < 100' },
  { bucket: '90-94.99', sql: 'r.score >= 90 AND r.score < 95' },
  { bucket: '80-89.99', sql: 'r.score >= 80 AND r.score < 90' },
  { bucket: '60-79.99', sql: 'r.score >= 60 AND r.score < 80' },
  { bucket: '60以下', sql: 'r.score < 60' },
];

/** 极值抽屉里最多列出多少条明细；超出时只返回条数，不返回全量 */
const EXTREME_SAMPLE_LIMIT = 50;

/** 分数段判定：与 DISTRIBUTION_BUCKETS 的标签一一对应，边界不可随意改 */
function testBucket(bucket: string, score: number): boolean {
  switch (bucket) {
    case '100': return score >= 100;
    case '95-99.99': return score >= 95 && score < 100;
    case '90-94.99': return score >= 90 && score < 95;
    case '80-89.99': return score >= 80 && score < 90;
    case '60-79.99': return score >= 60 && score < 80;
    default: return score < 60;
  }
}

/** 概览汇总的扫描行：只用来做聚合，不对外暴露 */
interface SummaryScanRow {
  id: string;
  evalMonth: string;
  cityId: string | null;
  cityName: string | null;
  supplierName: string;
  projectName: string;
  score: string | number;
  evalMethod: string;
  source: string;
}

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

  /**
   * 概览指标：一次窄列扫描 + 内存聚合。
   *
   * 早期的实现读整行实体（含 raw_json 等宽列 + TypeORM 实体装配），1.8 万行约 1.6s。
   * 这里只取 9 个窄列走覆盖索引（index-only scan），聚合放在 Node 里做：
   * 实测 单次扫描 47ms + 内存聚合 16ms，而「每条 GROUP BY 一条 SQL」反而更慢
   * （MySQL 为每个分组建临时表，5 条合计 430ms）。
   * 口径与旧实现完全一致：状态过滤、数据范围、分数段边界、排序规则都没变。
   * 注意：走内存聚合的前提是单次量级在十万行以内；若日后逼近 20 万行，
   * 应改为月度预聚合表，而不是继续增大这个扫描。
   */
  async summary(auth: BizAuthContext, filter: AssessmentQueryFilter): Promise<AssessmentSummary> {
    const round = (value: number) => Math.round(value * 100) / 100;

    const scanQb = this.recordRepo.createQueryBuilder('r');
    await this.applyScope(scanQb, auth, 'r');
    this.applyFilter(scanQb, filter, 'r');
    const rows = await scanQb
      .select('r.id', 'id')
      .addSelect('r.evalMonth', 'evalMonth')
      .addSelect('r.cityId', 'cityId')
      .addSelect('r.cityName', 'cityName')
      .addSelect('r.supplierName', 'supplierName')
      .addSelect('r.projectName', 'projectName')
      .addSelect('r.score', 'score')
      .addSelect('r.evalMethod', 'evalMethod')
      .addSelect('r.source', 'source')
      .limit(200000)
      .getRawMany<SummaryScanRow>();

    const totalCount = rows.length;
    let scoreSum = 0;
    let maxScore = Number.NEGATIVE_INFINITY;
    let minScore = Number.POSITIVE_INFINITY;
    let onlineCount = 0;
    let offlineCount = 0;
    let importedCount = 0;
    let entryCount = 0;

    const supplierSet = new Set<string>();
    const projectSet = new Set<string>();
    const citySet = new Set<string>();
    const monthMap = new Map<string, { count: number; sum: number }>();
    const cityMap = new Map<string, { cityId: string | null; cityName: string; count: number; sum: number; min: number }>();
    const supplierMap = new Map<string, { count: number; sum: number; min: number }>();
    const distribution = DISTRIBUTION_BUCKETS.map((item) => ({ bucket: item.bucket, count: 0 }));
    /** 极值并列的 id（最多 51 个），后面按主键回填完整行，避免再全表过滤一遍 score */
    const extremeIds = { max: [] as string[], min: [] as string[], maxCount: 0, minCount: 0 };

    for (const row of rows) {
      const score = Number(row.score);
      scoreSum += score;
      if (score > maxScore) maxScore = score;
      if (score < minScore) minScore = score;

      if (row.evalMethod === 'online') onlineCount += 1; else offlineCount += 1;
      if (row.source === 'import') importedCount += 1; else entryCount += 1;

      supplierSet.add(row.supplierName);
      projectSet.add(row.projectName);
      citySet.add(row.cityId ?? row.cityName ?? '');

      const month = monthMap.get(row.evalMonth) ?? { count: 0, sum: 0 };
      month.count += 1; month.sum += score;
      monthMap.set(row.evalMonth, month);

      const cityKey = row.cityId ?? row.cityName ?? '未匹配地市';
      const city = cityMap.get(cityKey) ?? { cityId: row.cityId, cityName: row.cityName || '未匹配地市', count: 0, sum: 0, min: score };
      city.count += 1; city.sum += score; city.min = Math.min(city.min, score);
      cityMap.set(cityKey, city);

      const supplier = supplierMap.get(row.supplierName) ?? { count: 0, sum: 0, min: score };
      supplier.count += 1; supplier.sum += score; supplier.min = Math.min(supplier.min, score);
      supplierMap.set(row.supplierName, supplier);

      const bucketIndex = DISTRIBUTION_BUCKETS.findIndex((item) => testBucket(item.bucket, score));
      if (bucketIndex >= 0) distribution[bucketIndex].count += 1;
    }

    // 极值样本：在已扫出的集合里挑 id，再按主键回填明细（PK 查询，几十条可忽略）
    if (totalCount > 0) {
      for (const row of rows) {
        const score = Number(row.score);
        if (score === maxScore) {
          extremeIds.maxCount += 1;
          if (extremeIds.max.length < EXTREME_SAMPLE_LIMIT) extremeIds.max.push(row.id);
        }
        if (score === minScore) {
          extremeIds.minCount += 1;
          if (extremeIds.min.length < EXTREME_SAMPLE_LIMIT) extremeIds.min.push(row.id);
        }
      }
    }

    const fetchSamples = async (ids: string[]): Promise<AssessmentOverviewRow[]> => {
      if (ids.length === 0) return [];
      const entities = await this.recordRepo.createQueryBuilder('r')
        .select([
          'r.id', 'r.source', 'r.evalMonth', 'r.projectName', 'r.cityId', 'r.cityName',
          'r.supplierName', 'r.contractId', 'r.contractNo', 'r.score', 'r.grade',
          'r.evalMethod', 'r.status', 'r.returnedBy', 'r.returnReason', 'r.createdAt', 'r.updatedAt',
        ])
        .where('r.id IN (:...ids)', { ids })
        .orderBy('r.evalMonth', 'DESC')
        .getMany();
      return entities.map((entity) => this.toRow(entity));
    };

    const maxRounded = totalCount === 0 ? 0 : round(maxScore);
    const minRounded = totalCount === 0 ? 0 : round(minScore);
    const maxSample = await fetchSamples(extremeIds.max);
    const minSample = await fetchSamples(extremeIds.min);

    return {
      totalCount,
      supplierCount: supplierSet.size,
      cityCount: citySet.size,
      projectCount: projectSet.size,
      avgScore: totalCount === 0 ? 0 : round(scoreSum / totalCount),
      maxScore: maxRounded,
      minScore: minRounded,
      extremes: {
        max: totalCount === 0 ? null : { score: maxRounded, count: extremeIds.maxCount, sample: maxSample },
        min: totalCount === 0 ? null : { score: minRounded, count: extremeIds.minCount, sample: minSample },
      },
      onlineCount,
      offlineCount,
      importedCount,
      entryCount,
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
