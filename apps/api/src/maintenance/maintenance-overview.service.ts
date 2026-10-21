import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MaintenancePersonnelEntity } from './personnel/personnel.entity';
import { MaintenanceVehicleEntity } from './vehicles/vehicle.entity';
import { MaintenanceGeneratorEntity } from './generators/generator.entity';
import { MaintenanceScopeService } from './maintenance-scope.service';
import type { BizAuthContext } from '../rbac/rbac.service';

/**
 * 维护管理「数据总览」聚合服务
 *
 * 背景：改造前前端为了算 4 个数字和 1 条提醒，会把三张表逐页翻完
 * （personnel 11 次 + vehicles 6 次 + generators 21 次 = 38 次请求、约 2.7MB）。
 * 这里把「计数 + 到期清单 + 组织汇总」一次算完，前端只发 1 个请求。
 *
 * 设计取舍：
 * 1. 计数与组织汇总交给 SQL（GROUP BY org_* 一次拿全，行数 = 组织数，不是记录数）
 * 2. 到期判定放到应用层：有效期列是 VARCHAR 文本，历史数据里混着「2027-14-01」「无」
 *    这类脏值，SQL 里用字符串比较会把它们当成零日期（0000-00-00）而误判为「已过期」。
 *    应用层统一用 parseLooseDate 解析，解析不了的单列为「日期异常」，绝不冒充已到期。
 * 3. 每个资产类型只查 1 次候选行（只取判定需要的列），不再分页。
 */

const CATEGORY_LABEL = { personnel: '人员', vehicles: '车辆', generators: '油机' } as const;
type AssetKind = keyof typeof CATEGORY_LABEL;

/** 到期字段清单：字段名 → 提醒标题 */
interface ExpiryField {
  field: string;
  title: string;
}

/**
 * 各资产类型的到期字段。
 * 说明：车辆「保养时间」与油机「保养记录最近一次上传时间」目前在生产库中 0 条有值，
 * 按「到期日」口径原样纳入清单；这两个字段到底是「上次保养」还是「下次保养到期」，
 * 需要业务确认后再决定是否换算周期，这里不做隐式加减。
 */
const EXPIRY_FIELDS: Record<AssetKind, ExpiryField[]> = {
  personnel: [
    { field: 'lowVoltageCertExpiry', title: '低压电工证到期' },
    { field: 'highVoltageCertExpiry', title: '高压电工证到期' },
    { field: 'workAtHeightCertExpiry', title: '登高证到期' },
    { field: 'employerLiabilityExpiry', title: '雇主责任险到期' },
    { field: 'teamAccidentExpiry', title: '团队意外险到期' },
    { field: 'teamAccidentExpiry2', title: '团队意外险到期#2' },
    { field: 'teamAccidentExpiry3', title: '团队意外险到期#3' },
  ],
  vehicles: [
    { field: 'compulsoryInsuranceExpiry', title: '交强险到期' },
    { field: 'commercialInsuranceExpiry', title: '商业险到期' },
    { field: 'maintenanceTime', title: '车辆保养到期' },
  ],
  generators: [
    { field: 'lastMaintenanceUploadAt', title: '油机保养到期' },
  ],
};

const NAME_FIELD: Record<AssetKind, string> = {
  personnel: 'name',
  vehicles: 'plateNumber',
  generators: 'generatorCode',
};

export interface MaintenanceReminder {
  id: string;
  kind: AssetKind;
  category: string;
  recordId: string;
  name: string;
  region: string;
  title: string;
  /** 已解析出的标准日期（YYYY-MM-DD）；日期异常行为原始文本 */
  date: string;
  /** 距今天数：负数=已逾期，0=今天，正数=还有 N 天；日期无法解析时为 null */
  days: number | null;
  /** 日期字段无法解析（如「无」「2027-14-01」） */
  invalidDate: boolean;
}

export interface MaintenanceOrganizationRow {
  region: string;
  personnel: number;
  vehicles: number;
  generators: number;
}

export interface MaintenanceOverviewResult {
  today: string;
  generatedAt: string;
  windowDays: number;
  counts: {
    personnel: number;
    vehicles: number;
    generators: number;
    /** 已到期（days < 0） */
    expired: number;
    /** 窗口内即将到期（0 <= days <= windowDays） */
    dueSoon: number;
    /** 待办合计 = expired + dueSoon + 日期异常 */
    pending: number;
    /** 日期字段无法解析的条数 */
    anomaly: number;
  };
  /** 按资产类别拆分的待办，便于分辨「车辆 278 / 人员 142」这类差异 */
  byKind: Array<{ kind: AssetKind; category: string; expired: number; dueSoon: number; anomaly: number; total: number }>;
  reminders: MaintenanceReminder[];
  organizations: MaintenanceOrganizationRow[];
}

const DAY_MS = 86_400_000;

/** 北京时间「今天」，避开容器时区（UTC）在 00:00-08:00 之间算错一天 */
function shanghaiToday(): string {
  const shifted = new Date(Date.now() + 8 * 3_600_000);
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const day = String(shifted.getUTCDate()).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${month}-${day}`;
}

function isoOf(year: number, month: number, day: number): string | null {
  const stamp = Date.UTC(year, month - 1, day);
  const date = new Date(stamp);
  // 反查一遍，拦掉 2026-02-30 / 2027-14-01 这类非法组合
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * 宽松解析有效期文本。
 * 支持：2026-10-21 / 2026/10/21 / 2026.10.21 / 2026年10月21日 / 2026-1-5 / 至2027年8月19日 / Excel 序列号
 * 不支持（返回 null）：空值、纯文字（如「无」「长期」）、月份/日期越界的非法日期
 */
export function parseLooseDate(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) {
    if (Number.isNaN(raw.getTime())) return null;
    return isoOf(raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate());
  }
  let text = String(raw).trim();
  if (!text) return null;
  // 去掉「至 2027年8月19日」「有效期到…」这类前缀
  text = text.replace(/^[至到]\s*/, '').replace(/^有效期\s*(至|到)?\s*/, '').trim();
  if (!text) return null;
  if (/^\d{5}(\.\d+)?$/.test(text)) {
    // Excel 序列号（1899-12-30 起算）
    const serial = Math.floor(Number(text));
    const date = new Date(Date.UTC(1899, 11, 30) + serial * DAY_MS);
    return isoOf(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
  }
  const matched = /^(\d{4})\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})\s*日?$/.exec(text);
  if (!matched) return null;
  return isoOf(Number(matched[1]), Number(matched[2]), Number(matched[3]));
}

function daysBetween(today: string, date: string): number {
  const [ty, tm, td] = today.split('-').map(Number);
  const [dy, dm, dd] = date.split('-').map(Number);
  return Math.round((Date.UTC(dy, dm - 1, dd) - Date.UTC(ty, tm - 1, td)) / DAY_MS);
}

function regionOf(row: Record<string, unknown>): string {
  const text = (key: string) => {
    const value = row[key];
    return value === null || value === undefined ? '' : String(value);
  };
  const city = text('orgCity') || text('city');
  return `${text('orgProvince') || text('province')} / ${city || '未填写地市'} / ${text('orgRegion') || text('region')} / ${text('orgCompany') || text('company')}`;
}

@Injectable()
export class MaintenanceOverviewService {
  constructor(
    @InjectRepository(MaintenancePersonnelEntity) private readonly personnelRepo: Repository<MaintenancePersonnelEntity>,
    @InjectRepository(MaintenanceVehicleEntity) private readonly vehicleRepo: Repository<MaintenanceVehicleEntity>,
    @InjectRepository(MaintenanceGeneratorEntity) private readonly generatorRepo: Repository<MaintenanceGeneratorEntity>,
    private readonly scope: MaintenanceScopeService,
  ) {}

  private repoOf(kind: AssetKind): Repository<object> {
    if (kind === 'personnel') return this.personnelRepo as unknown as Repository<object>;
    if (kind === 'vehicles') return this.vehicleRepo as unknown as Repository<object>;
    return this.generatorRepo as unknown as Repository<object>;
  }

  /** 组织汇总 + 该类资产总数：一次 GROUP BY 拿到，行数等于组织数 */
  private async groupByOrg(kind: AssetKind, auth: BizAuthContext): Promise<{ rows: MaintenanceOrganizationRow[]; total: number }> {
    const repo = this.repoOf(kind);
    const qb = repo.createQueryBuilder('t')
      .select('t.orgProvince', 'province')
      .addSelect('t.orgCity', 'city')
      .addSelect('t.orgCompany', 'company')
      .addSelect('t.orgRegion', 'region')
      .addSelect('COUNT(*)', 'total')
      .where('t.deletedAt IS NULL')
      .groupBy('t.orgProvince')
      .addGroupBy('t.orgCity')
      .addGroupBy('t.orgCompany')
      .addGroupBy('t.orgRegion');
    this.scope.apply(qb, await this.scope.resolve(auth), 't');
    const raw = await qb.getRawMany<{ province: string | null; city: string | null; company: string | null; region: string | null; total: string | number }>();
    const rows: MaintenanceOrganizationRow[] = raw.map((row) => ({
      region: regionOf(row),
      personnel: 0,
      vehicles: 0,
      generators: 0,
      [kind]: Number(row.total) || 0,
    } as MaintenanceOrganizationRow));
    return { rows, total: raw.reduce((sum, row) => sum + (Number(row.total) || 0), 0) };
  }

  /** 该类资产里「至少一个有效期字段有值」的记录，只取判定与展示需要的列 */
  private async expiryRows(kind: AssetKind, auth: BizAuthContext): Promise<Array<Record<string, unknown>>> {
    const repo = this.repoOf(kind);
    const fields = EXPIRY_FIELDS[kind];
    const columns = ['id', NAME_FIELD[kind], 'orgProvince', 'orgCity', 'orgCompany', 'orgRegion', ...fields.map((item) => item.field)];
    const qb = repo.createQueryBuilder('t')
      .select(columns.map((column) => `t.${column}`))
      .where('t.deletedAt IS NULL')
      .andWhere(`(${fields.map((item) => `NULLIF(TRIM(t.${item.field}), '') IS NOT NULL`).join(' OR ')})`);
    this.scope.apply(qb, await this.scope.resolve(auth), 't');
    return qb.getMany() as unknown as Array<Record<string, unknown>>;
  }

  /**
   * 筛选项字典：区县/地市/公司下拉用服务端 distinct。
   * 改造前区县下拉取的是「当前页 50 条」，翻页后选项会变、选不到别的区县。
   */
  async facets(kind: AssetKind, auth: BizAuthContext, filter: { orgProvince?: string; orgCity?: string } = {}): Promise<{ provinces: string[]; cities: string[]; companies: string[]; regions: string[] }> {
    const repo = this.repoOf(kind);
    const qb = repo.createQueryBuilder('t')
      .select('t.orgProvince', 'province')
      .addSelect('t.orgCity', 'city')
      .addSelect('t.orgCompany', 'company')
      .addSelect('t.orgRegion', 'region')
      .where('t.deletedAt IS NULL')
      .groupBy('t.orgProvince')
      .addGroupBy('t.orgCity')
      .addGroupBy('t.orgCompany')
      .addGroupBy('t.orgRegion');
    // 级联筛选：选中省份后只统计该省，选中地市后只统计该市 —— 否则区县下拉是全省全集，
    // 选了「济宁市」还能看到「滕州市」，用户会选出一个空结果
    if (filter.orgProvince?.trim()) qb.andWhere('t.orgProvince LIKE :fProvince', { fProvince: `%${filter.orgProvince.trim()}%` });
    if (filter.orgCity?.trim()) qb.andWhere('t.orgCity LIKE :fCity', { fCity: `%${filter.orgCity.trim()}%` });
    this.scope.apply(qb, await this.scope.resolve(auth), 't');
    const rows = await qb.getRawMany<{ province: string | null; city: string | null; company: string | null; region: string | null }>();
    const collect = (pick: (row: { province: string | null; city: string | null; company: string | null; region: string | null }) => string | null) =>
      [...new Set(rows.map(pick).filter((value): value is string => Boolean(value && String(value).trim())))].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    return {
      provinces: collect((row) => row.province),
      cities: collect((row) => row.city),
      companies: collect((row) => row.company),
      regions: collect((row) => row.region),
    };
  }

  async build(windowDaysInput: number | undefined, auth: BizAuthContext): Promise<MaintenanceOverviewResult> {
    const windowDays = Math.min(3650, Math.max(1, Number(windowDaysInput) || 30));
    const today = shanghaiToday();
    const kinds: AssetKind[] = ['personnel', 'vehicles', 'generators'];

    // 6 个查询并发：每类资产 1 个组织汇总 + 1 个到期候选
    const [groups, candidates] = await Promise.all([
      Promise.all(kinds.map((kind) => this.groupByOrg(kind, auth))),
      Promise.all(kinds.map((kind) => this.expiryRows(kind, auth))),
    ]);

    const counts = { personnel: 0, vehicles: 0, generators: 0, expired: 0, dueSoon: 0, pending: 0, anomaly: 0 };
    const organizationMap = new Map<string, MaintenanceOrganizationRow>();
    kinds.forEach((kind, index) => {
      const { rows, total } = groups[index];
      counts[kind] = total;
      for (const row of rows) {
        const merged = organizationMap.get(row.region) ?? { region: row.region, personnel: 0, vehicles: 0, generators: 0 };
        merged[kind] += row[kind];
        organizationMap.set(row.region, merged);
      }
    });

    const reminders: MaintenanceReminder[] = [];
    const byKind = kinds.map((kind) => ({ kind, category: CATEGORY_LABEL[kind], expired: 0, dueSoon: 0, anomaly: 0, total: 0 }));
    kinds.forEach((kind, index) => {
      const bucket = byKind[index];
      const nameField = NAME_FIELD[kind];
      for (const row of candidates[index]) {
        const region = regionOf(row);
        const name = String(row[nameField] ?? '').trim() || '（未填写名称）';
        for (const { field, title } of EXPIRY_FIELDS[kind]) {
          const rawValue = row[field];
          if (rawValue === null || rawValue === undefined) continue;
          const rawText = String(rawValue).trim();
          if (!rawText) continue;
          const parsed = parseLooseDate(rawValue);
          const id = `${kind}-${String(row.id)}-${field}`;
          if (!parsed) {
            counts.anomaly += 1;
            bucket.anomaly += 1;
            reminders.push({ id, kind, category: CATEGORY_LABEL[kind], recordId: String(row.id), name, region, title, date: rawText, days: null, invalidDate: true });
            continue;
          }
          const days = daysBetween(today, parsed);
          if (days > windowDays) continue;
          if (days < 0) { counts.expired += 1; bucket.expired += 1; }
          else { counts.dueSoon += 1; bucket.dueSoon += 1; }
          reminders.push({ id, kind, category: CATEGORY_LABEL[kind], recordId: String(row.id), name, region, title, date: parsed, days, invalidDate: false });
        }
      }
      bucket.total = bucket.expired + bucket.dueSoon + bucket.anomaly;
    });

    // 逾期最久的排最前；日期异常沉到列表末尾（仍是待办，需要人工修数据）
    reminders.sort((a, b) => {
      if (a.invalidDate !== b.invalidDate) return a.invalidDate ? 1 : -1;
      return (a.days ?? 0) - (b.days ?? 0) || a.category.localeCompare(b.category) || a.name.localeCompare(b.name);
    });
    counts.pending = counts.expired + counts.dueSoon + counts.anomaly;

    return {
      today,
      generatedAt: new Date().toISOString(),
      windowDays,
      counts,
      byKind,
      reminders,
      organizations: [...organizationMap.values()].sort((a, b) => a.region.localeCompare(b.region, 'zh-CN')),
    };
  }
}
