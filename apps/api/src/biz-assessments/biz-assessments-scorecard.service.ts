import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AssessmentRecordEntity } from './assessment-record.entity';
import { CityEntity } from '../main-data/city.entity';
import { ProvinceEntity } from '../main-data/province.entity';
import { BizAuthContext } from '../rbac/rbac.service';
import { rankDesc } from '../common/ranking';

/** 计入统计的状态：导入行 active、线下填报已提交 */
const EFFECTIVE_STATUSES = ['active', 'submitted'];

export interface SupplierScorecardRow {
  projectName: string;
  provinceId: string | null;
  provinceName: string;
  monthScore: number;
  monthCount: number;
  totalScore: number;
  totalCount: number;
  avgScore: number;
  avgRank: number | null;
  totalRank: number | null;
  /** 本月得分排名的环比变化：正数=名次前进，负数=后退，null=上月无数据或仅一家 */
  monthRankDelta: number | null;
  /** 本月得分排名（同项目同月，按当月得分） */
  monthRank: number | null;
  /** 平均分与榜首的差（负数=落后） */
  gapToLeaderAvg: number;
  /** 总分与榜首的差 */
  gapToLeaderTotal: number;
  supplierCount: number;
  singleSupplier: boolean;
  hasMonthData: boolean;
}

export interface SupplierScorecard {
  supplier: string;
  requestedMonth: string | null;
  month: string | null;
  months: string[];
  rows: SupplierScorecardRow[];
  totals: { projectCount: number; monthScore: number; totalScore: number; avgScore: number; singleSupplierCount: number };
  rankingBasis: { avg: string; total: string; scope: string };
}

export interface BreakdownRow {
  cityName: string;
  supplierName: string;
  monthScore: number;
  monthCount: number;
  totalScore: number;
  totalCount: number;
  avgScore: number;
  monthRank: number | null;
  totalRank: number | null;
}

export interface BreakdownSupplierRow {
  supplierName: string;
  totalScore: number;
  totalCount: number;
  avgScore: number;
  avgRank: number | null;
  totalRank: number | null;
  isFocus: boolean;
}

export interface BreakdownGroup extends BreakdownSupplierRow {
  cities: Array<{ cityName: string; avgScore: number; totalScore: number; monthCount: number }>;
  gapToLeaderAvg: number;
  gapToLeaderTotal: number;
  monthCount: number;
}

export interface TrendPoint {
  month: string;
  monthScore: number;
  monthCount: number;
  monthAvg: number;
  avgRank: number | null;
  totalRank: number | null;
}

export interface ProjectBreakdown {
  projectName: string;
  month: string | null;
  focusSupplier: string;
  block1: BreakdownRow[];
  block2: BreakdownSupplierRow[];
  block3: BreakdownGroup[];
  trend: TrendPoint[];
  supplierCount: number;
}

interface CityAgg {
  monthSum: number;
  monthCount: number;
  totalSum: number;
  totalCount: number;
  months: Set<string>;
}

interface SupplierAgg {
  monthSum: number;
  monthCount: number;
  totalSum: number;
  totalCount: number;
  cities: Map<string, CityAgg>;
}

interface ProjectAgg {
  projectName: string;
  provinceId: string | null;
  suppliers: Map<string, SupplierAgg>;
}

const round2 = (value: number): number => Math.round(value * 100) / 100;
const safeDiv = (sum: number, count: number): number => (count > 0 ? round2(sum / count) : 0);

/** 月份减一：2025-01 → 2024-12 */
function prevMonthOf(month: string): string {
  const [year, mon] = month.split('-').map(Number);
  const total = year * 12 + (mon - 1) - 1;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

function emptySupplierAgg(): SupplierAgg {
  return { monthSum: 0, monthCount: 0, totalSum: 0, totalCount: 0, cities: new Map() };
}

/**
 * 明细聚合只需要这 7 列。
 * 不用完整实体：一是避免把 raw_json / 合同号 / 时间戳等宽列读上来，
 * 二是 getRawMany 不做实体装配，1.8 万行时省掉约 800ms。
 */
interface AssessmentLiteRow {
  evalMonth: string;
  projectName: string;
  provinceId: string | null;
  cityId: string | null;
  cityName: string | null;
  supplierName: string;
  score: string | number;
}

/** 把一批明细聚合成「项目 → 供应商 → 地市」三级结构；month 决定「本月」口径 */
function accumulate(rows: AssessmentLiteRow[], month: string | null): Map<string, ProjectAgg> {
  const projects = new Map<string, ProjectAgg>();
  for (const row of rows) {
    let project = projects.get(row.projectName);
    if (!project) {
      project = { projectName: row.projectName, provinceId: row.provinceId, suppliers: new Map() };
      projects.set(row.projectName, project);
    }
    let supplier = project.suppliers.get(row.supplierName);
    if (!supplier) { supplier = emptySupplierAgg(); project.suppliers.set(row.supplierName, supplier); }

    const score = Number(row.score);
    supplier.totalSum += score;
    supplier.totalCount += 1;
    const isMonth = month !== null && row.evalMonth === month;
    if (isMonth) { supplier.monthSum += score; supplier.monthCount += 1; }

    const cityKey = row.cityId ?? row.cityName ?? '';
    let city = supplier.cities.get(cityKey);
    if (!city) { city = { monthSum: 0, monthCount: 0, totalSum: 0, totalCount: 0, months: new Set() }; supplier.cities.set(cityKey, city); }
    city.totalSum += score;
    city.totalCount += 1;
    city.months.add(row.evalMonth);
    if (isMonth) { city.monthSum += score; city.monthCount += 1; }
  }
  return projects;
}

/**
 * 供应商明细与单合同排名解剖（工程管理 / 后评估管理）
 *
 * 口径（对齐原汇报表，同时修正原表的三套均分口径）：
 *  - 本月得分 = 选中月份下该供应商在该项目所有明细的分数之和
 *  - 累计总分 = 选中月份及以前所有明细的分数之和
 *  - 平均分   = 累计总分 ÷ 明细条数（加权），不再用「各地市平均分再平均」
 *  - 排名     = 同项目内全体供应商按平均分 / 总分降序的标准竞赛排名
 *  - 排名分母永远基于全体供应商，不随主表的供应商/项目筛选变化
 */
@Injectable()
export class BizAssessmentsScorecardService {
  constructor(
    @InjectRepository(AssessmentRecordEntity) private readonly recordRepo: Repository<AssessmentRecordEntity>,
    @InjectRepository(CityEntity) private readonly cityRepo: Repository<CityEntity>,
    @InjectRepository(ProvinceEntity) private readonly provinceRepo: Repository<ProvinceEntity>,
  ) {}

  /** 数据范围：null 表示不限；空数组表示无任何可见地市 */
  private scopedCityIds(auth: BizAuthContext): string[] | null {
    const scope = auth.dataScope;
    if (auth.isSuperAdmin || scope.scopeType === 'all' || scope.allowAll) return null;
    const ids = new Set<string>(scope.cityIds ?? []);
    if (scope.cityId) ids.add(scope.cityId);
    return [...ids];
  }

  private async loadRows(
    auth: BizAuthContext,
    options: { uptoMonth: string; projectName?: string; projectNames?: string[] },
  ): Promise<AssessmentLiteRow[]> {
    const qb = this.recordRepo.createQueryBuilder('r')
      .where('r.status IN (:...statuses)', { statuses: EFFECTIVE_STATUSES })
      .andWhere('r.evalMonth <= :uptoMonth', { uptoMonth: options.uptoMonth });
    if (options.projectName) qb.andWhere('r.projectName = :projectName', { projectName: options.projectName });
    if (options.projectNames?.length) qb.andWhere('r.projectName IN (:...projectNames)', { projectNames: options.projectNames });
    const scopeIds = this.scopedCityIds(auth);
    if (scopeIds !== null) {
      if (scopeIds.length === 0) return [];
      qb.andWhere('r.cityId IN (:...scopeIds)', { scopeIds });
    }
    return qb
      .select('r.evalMonth', 'evalMonth')
      .addSelect('r.projectName', 'projectName')
      .addSelect('r.provinceId', 'provinceId')
      .addSelect('r.cityId', 'cityId')
      .addSelect('r.cityName', 'cityName')
      .addSelect('r.supplierName', 'supplierName')
      .addSelect('r.score', 'score')
      .limit(200000)
      .getRawMany<AssessmentLiteRow>();
  }

  private async availableMonths(auth: BizAuthContext): Promise<string[]> {
    const qb = this.recordRepo.createQueryBuilder('r')
      .select('r.evalMonth', 'month')
      .where('r.status IN (:...statuses)', { statuses: EFFECTIVE_STATUSES });
    const scopeIds = this.scopedCityIds(auth);
    if (scopeIds !== null) {
      if (scopeIds.length === 0) return [];
      qb.andWhere('r.cityId IN (:...scopeIds)', { scopeIds });
    }
    const rows = await qb.groupBy('r.evalMonth').orderBy('r.evalMonth', 'DESC').getRawMany<{ month: string }>();
    return rows.map((row) => row.month);
  }

  private async provinceNames(): Promise<Map<string, string>> {
    const provinces = await this.provinceRepo.find();
    return new Map(provinces.map((province) => [province.id, province.name]));
  }

  // ==================== 供应商明细 ====================

  async scorecard(auth: BizAuthContext, params: {
    supplier: string; month?: string; projectNames?: string[]; provinceIds?: string[];
  }): Promise<SupplierScorecard> {
    const supplier = params.supplier?.trim();
    const months = await this.availableMonths(auth);
    const month = params.month && months.includes(params.month) ? params.month : months[0] ?? null;
    const base: SupplierScorecard = {
      supplier,
      requestedMonth: params.month ?? null,
      month,
      months,
      rows: [],
      totals: { projectCount: 0, monthScore: 0, totalScore: 0, avgScore: 0, singleSupplierCount: 0 },
      rankingBasis: {
        avg: '累计总分 ÷ 明细条数（加权）',
        total: '选中月份及以前所有明细分数之和',
        scope: '同项目内全体供应商，分母不随筛选变化',
      },
    };
    if (!supplier || !month) return base;

    const rows = await this.loadRows(auth, { uptoMonth: month, projectNames: params.projectNames });
    const prevMonth = prevMonthOf(month);
    const current = accumulate(rows, month);
    // 上月切片单独聚合：环比用「当月得分排名」，比累计排名变化更有意义
    const previous = accumulate(rows.filter((row) => row.evalMonth === prevMonth), prevMonth);
    const provinceName = await this.provinceNames();

    const result: SupplierScorecardRow[] = [];
    for (const project of current.values()) {
      const focus = project.suppliers.get(supplier);
      if (!focus || focus.totalCount === 0) continue;

      const all = [...project.suppliers.values()];
      const avgs = all.map((item) => item.totalSum / item.totalCount);
      const sums = all.map((item) => item.totalSum);
      const focusAvg = focus.totalSum / focus.totalCount;
      const supplierCount = all.length;
      const singleSupplier = supplierCount <= 1;

      const avgRank = singleSupplier ? null : rankDesc(avgs, focusAvg);
      const totalRank = singleSupplier ? null : rankDesc(sums, focus.totalSum);

      // 当月排名与环比：用「当月得分」排名，环比自然反映本月升/降
      const monthScores = all.filter((item) => item.monthCount > 0).map((item) => item.monthSum);
      const monthRank = focus.monthCount > 0 && monthScores.length > 1 ? rankDesc(monthScores, focus.monthSum) : null;

      // 上月名次（用于「排名变化」列）
      const prevProject = previous.get(project.projectName);
      const prevFocus = prevProject?.suppliers.get(supplier);
      let prevMonthRank: number | null = null;
      if (prevProject && prevFocus && prevFocus.monthCount > 0) {
        const prevMonthScores = [...prevProject.suppliers.values()]
          .filter((item) => item.monthCount > 0)
          .map((item) => item.monthSum);
        if (prevMonthScores.length > 1) prevMonthRank = rankDesc(prevMonthScores, prevFocus.monthSum);
      }

      result.push({
        projectName: project.projectName,
        provinceId: project.provinceId,
        provinceName: project.provinceId ? (provinceName.get(project.provinceId) ?? '') : '',
        monthScore: round2(focus.monthSum),
        monthCount: focus.monthCount,
        totalScore: round2(focus.totalSum),
        totalCount: focus.totalCount,
        avgScore: round2(focusAvg),
        avgRank,
        totalRank,
        monthRank,
        monthRankDelta: monthRank === null || prevMonthRank === null ? null : prevMonthRank - monthRank,
        gapToLeaderAvg: singleSupplier ? 0 : round2(focusAvg - Math.max(...avgs)),
        gapToLeaderTotal: singleSupplier ? 0 : round2(focus.totalSum - Math.max(...sums)),
        supplierCount,
        singleSupplier,
        hasMonthData: focus.monthCount > 0,
      });
    }

    const filtered = params.provinceIds?.length
      ? result.filter((row) => row.provinceId !== null && params.provinceIds?.includes(row.provinceId))
      : result;

    filtered.sort((a, b) => {
      if (a.hasMonthData !== b.hasMonthData) return a.hasMonthData ? -1 : 1;
      const rankA = a.avgRank ?? 999;
      const rankB = b.avgRank ?? 999;
      if (rankA !== rankB) return rankA - rankB;
      return b.totalScore - a.totalScore;
    });

    const totalScore = filtered.reduce((sum, row) => sum + row.totalScore, 0);
    const totalCount = filtered.reduce((sum, row) => sum + row.totalCount, 0);
    return {
      ...base,
      rows: filtered,
      totals: {
        projectCount: filtered.length,
        monthScore: round2(filtered.reduce((sum, row) => sum + row.monthScore, 0)),
        totalScore: round2(totalScore),
        avgScore: safeDiv(totalScore, totalCount),
        singleSupplierCount: filtered.filter((row) => row.singleSupplier).length,
      },
    };
  }

  // ==================== 单合同排名解剖 ====================

  async breakdown(auth: BizAuthContext, params: { projectName: string; month?: string; supplier: string }): Promise<ProjectBreakdown> {
    const months = await this.availableMonths(auth);
    const month = params.month && months.includes(params.month) ? params.month : months[0] ?? null;
    const empty: ProjectBreakdown = {
      projectName: params.projectName, month, focusSupplier: params.supplier,
      block1: [], block2: [], block3: [], trend: [], supplierCount: 0,
    };
    if (!params.projectName || !month) return empty;

    const latest = months[0] ?? month;
    const rows = await this.loadRows(auth, { uptoMonth: latest, projectName: params.projectName });
    if (rows.length === 0) return empty;

    // 块①：地市 × 供应商（当月得分 + 累计）
    const block1Map = new Map<string, BreakdownRow>();
    for (const row of rows) {
      const key = `${row.cityId ?? row.cityName}|${row.supplierName}`;
      let item = block1Map.get(key);
      if (!item) {
        item = {
          cityName: row.cityName || '省本部/未匹配', supplierName: row.supplierName,
          monthScore: 0, monthCount: 0, totalScore: 0, totalCount: 0, avgScore: 0, monthRank: null, totalRank: null,
        };
        block1Map.set(key, item);
      }
      const score = Number(row.score);
      item.totalScore += score;
      item.totalCount += 1;
      if (row.evalMonth === month) { item.monthScore += score; item.monthCount += 1; }
    }
    const block1 = [...block1Map.values()].map((item) => ({
      ...item,
      monthScore: round2(item.monthScore),
      totalScore: round2(item.totalScore),
      avgScore: safeDiv(item.totalScore, item.totalCount),
    }));
    const block1Month = block1.map((item) => item.monthScore);
    const block1Total = block1.map((item) => item.totalScore);
    for (const item of block1) {
      // 选中月份没有数据的行不参与当月排名，否则会把「无数据」排成末位
      item.monthRank = item.monthCount > 0 ? rankDesc(block1Month, item.monthScore) : null;
      item.totalRank = rankDesc(block1Total, item.totalScore);
    }
    block1.sort((a, b) => a.cityName.localeCompare(b.cityName, 'zh-CN') || b.totalScore - a.totalScore);

    // 块②/块③：供应商（省级）
    const projects = accumulate(rows, month);
    const project = projects.get(params.projectName);
    const supplierEntries = project ? [...project.suppliers.entries()] : [];
    const avgValues = supplierEntries.map(([, agg]) => agg.totalSum / agg.totalCount);
    const sumValues = supplierEntries.map(([, agg]) => agg.totalSum);
    const maxAvg = avgValues.length ? Math.max(...avgValues) : 0;
    const maxSum = sumValues.length ? Math.max(...sumValues) : 0;
    const multiSupplier = supplierEntries.length > 1;

    const block2: BreakdownSupplierRow[] = supplierEntries.map(([name, agg]) => {
      const avg = agg.totalSum / agg.totalCount;
      return {
        supplierName: name,
        totalScore: round2(agg.totalSum),
        totalCount: agg.totalCount,
        avgScore: round2(avg),
        avgRank: multiSupplier ? rankDesc(avgValues, avg) : null,
        totalRank: multiSupplier ? rankDesc(sumValues, agg.totalSum) : null,
        isFocus: name === params.supplier,
      };
    }).sort((a, b) => (a.avgRank ?? 999) - (b.avgRank ?? 999) || b.totalScore - a.totalScore);

    const cityDict = new Map<string, string>();
    for (const city of await this.cityRepo.find()) cityDict.set(city.id, city.name);

    const block3: BreakdownGroup[] = supplierEntries.map(([name, agg]) => {
      const avg = agg.totalSum / agg.totalCount;
      const cities = [...agg.cities.entries()]
        .map(([key, city]) => ({
          cityName: cityDict.get(key) ?? (key || '省本部/未匹配'),
          avgScore: safeDiv(city.totalSum, city.totalCount),
          totalScore: round2(city.totalSum),
          monthCount: city.months.size,
        }))
        .sort((a, b) => b.totalScore - a.totalScore);
      const monthCount = new Set([...agg.cities.values()].flatMap((city) => [...city.months])).size;
      return {
        supplierName: name,
        totalScore: round2(agg.totalSum),
        totalCount: agg.totalCount,
        avgScore: round2(avg),
        avgRank: multiSupplier ? rankDesc(avgValues, avg) : null,
        totalRank: multiSupplier ? rankDesc(sumValues, agg.totalSum) : null,
        isFocus: name === params.supplier,
        cities,
        gapToLeaderAvg: round2(avg - maxAvg),
        gapToLeaderTotal: round2(agg.totalSum - maxSum),
        monthCount,
      };
    }).sort((a, b) => (a.avgRank ?? 999) - (b.avgRank ?? 999) || b.totalScore - a.totalScore);

    // 趋势：聚焦供应商逐月（分数 + 当月排名 + 累计排名）
    const trend: TrendPoint[] = [];
    for (const targetMonth of [...months].reverse()) {
      if (targetMonth > latest) continue;
      const monthly = accumulate(rows.filter((row) => row.evalMonth <= targetMonth), targetMonth);
      const targetProject = monthly.get(params.projectName);
      const focus = targetProject?.suppliers.get(params.supplier);
      if (!targetProject || !focus) continue;
      const all = [...targetProject.suppliers.values()];
      const focusAvg = focus.totalCount > 0 ? focus.totalSum / focus.totalCount : 0;
      trend.push({
        month: targetMonth,
        monthScore: round2(focus.monthSum),
        monthCount: focus.monthCount,
        monthAvg: safeDiv(focus.monthSum, focus.monthCount),
        avgRank: all.length > 1 ? rankDesc(all.map((item) => item.totalSum / item.totalCount), focusAvg) : null,
        totalRank: all.length > 1 ? rankDesc(all.map((item) => item.totalSum), focus.totalSum) : null,
      });
    }

    return {
      projectName: params.projectName,
      month,
      focusSupplier: params.supplier,
      block1,
      block2,
      block3,
      trend,
      supplierCount: supplierEntries.length,
    };
  }
}
