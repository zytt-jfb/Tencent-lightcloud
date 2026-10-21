/**
 * 维护数据的合规状态计算（纯函数，无 React 依赖）
 *
 * 口径（已与用户确认）：
 *   · 人员合规 = 三证齐全且在有效期内 + 雇主责任险有效
 *   · 车辆合规 = 交强险 + 商业险均在有效期内
 *   · 油机没有约定合规口径，只显示「最近保养记录」登记情况，不参与合规判定
 *
 * 为什么单独抽出来：列表过去只有姓名/组织五列，用户要判断一个人能不能上岗，
 * 得点进详情把 32 个字段里四个到期日一个个比对。这里把判断收敛成一个状态，
 * 列表一眼可读，且口径只在一处定义（改口径不用找散落在三个页面的逻辑）。
 */

export type AssetKind = 'personnel' | 'vehicles' | 'generators';

/** 单个日期字段的判定结果 */
export type DateState = 'ok' | 'expiring' | 'expired' | 'missing' | 'invalid';

export interface DateVerdict {
  state: DateState;
  /** 解析出来的到期日；解析失败为 null */
  date: Date | null;
  /** 距今天数：负数=已过期；null=缺失或无效 */
  days: number | null;
}

/** 合规整体等级：ok 绿 / warn 橙 / bad 红 */
export type ComplianceLevel = 'ok' | 'warn' | 'bad';

export interface CompliancePart {
  label: string;
  text: string;
  level: ComplianceLevel;
}

export interface ComplianceSummary {
  level: ComplianceLevel;
  /** 列表单元格里的短文案，例如「证照 2/3 · 保险 已过期12天」 */
  text: string;
  /** 悬浮提示用的明细 */
  parts: CompliancePart[];
}

/** 默认 30 天内视为临期，与后端总览的 windowDays 默认值保持一致 */
export const EXPIRING_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 宽松日期解析。
 *
 * 维护表的到期字段是 VARCHAR，历史数据里实际存在这些写法：
 *   `2026-10-21`、`2026/10/21`、`2026.10.21`、`2026年10月21日`、`2026-1-5`、
 *   `至2027年8月19日`、`无`、`2027-14-01`（非法月份）、`45890`（Excel 序列号）
 * 后端 maintenance-overview.service 里有一份等价实现（服务端算总览用）；
 * 这里保留前端副本是因为列表要就地判定，不能每条都请求一次后端。
 * 两处规则必须同步修改。
 */
export function parseLooseDate(raw: unknown): Date | null {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;

  if (typeof raw === 'number' && Number.isFinite(raw)) return fromExcelSerial(raw);

  const text = String(raw).trim();
  if (!text) return null;

  // Excel 序列号以文本形式存储的情况
  if (/^\d{5}(\.\d+)?$/.test(text)) return fromExcelSerial(Number(text));

  // 去掉「至」「截至」这类前缀
  const cleaned = text.replace(/^(至|截止|有效期至|有效期)\s*/u, '').trim();

  const match = cleaned.match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?$/u);
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    return buildDate(year, month, day);
  }
  return null;
}

/** 构造并回查：`new Date(2027, 13, 1)` 会自动进位成 2028-02-01，必须用组件反查拦下来 */
function buildDate(year: number, month: number, day: number): Date | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

/** Excel 序列号：1899-12-30 起算（含 1900 闰年 bug 的既有约定） */
function fromExcelSerial(serial: number): Date | null {
  if (serial < 1 || serial > 80000) return null;
  const base = Date.UTC(1899, 11, 30);
  const date = new Date(base + Math.round(serial) * DAY_MS);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 只比较日期部分，避免「今天 14:00 到期」这种同日误判 */
function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function judgeDate(raw: unknown, today: Date = new Date(), windowDays = EXPIRING_DAYS): DateVerdict {
  if (raw === null || raw === undefined || String(raw).trim() === '') return { state: 'missing', date: null, days: null };
  const date = parseLooseDate(raw);
  if (!date) return { state: 'invalid', date: null, days: null };
  const days = Math.round((startOfDay(date).getTime() - startOfDay(today).getTime()) / DAY_MS);
  if (days < 0) return { state: 'expired', date, days };
  if (days <= windowDays) return { state: 'expiring', date, days };
  return { state: 'ok', date, days };
}

/** 单个日期字段的短文案，例如「已过期12天」「12天后到期」 */
export function dateText(verdict: DateVerdict): string {
  switch (verdict.state) {
    case 'missing': return '未登记';
    case 'invalid': return '日期异常';
    case 'expired': return `已过期${Math.abs(verdict.days ?? 0)}天`;
    case 'expiring': return verdict.days === 0 ? '今天到期' : `${verdict.days}天后到期`;
    default: return '有效';
  }
}

function worstLevel(states: DateState[]): ComplianceLevel {
  if (states.some((state) => state === 'expired')) return 'bad';
  if (states.some((state) => state !== 'ok')) return 'warn';
  return 'ok';
}

function hasValue(value: unknown): boolean {
  return !(value === null || value === undefined || String(value).trim() === '');
}

/** 人员三证：证号 + 到期日，两列成对判定 */
const PERSONNEL_CERTS = [
  { code: 'lowVoltageCert', expiry: 'lowVoltageCertExpiry', label: '低压电工证' },
  { code: 'highVoltageCert', expiry: 'highVoltageCertExpiry', label: '高压电工证' },
  { code: 'workAtHeightCert', expiry: 'workAtHeightCertExpiry', label: '登高证' },
] as const;

export function personnelCompliance(row: Record<string, unknown>, today: Date = new Date()): ComplianceSummary {
  const certDetails: CompliancePart[] = [];
  let valid = 0;
  let pending = 0;
  let invalid = 0;

  for (const cert of PERSONNEL_CERTS) {
    // 三种情况要分开看，否则「有证但没登记到期日」会被算成「没证」，列表一片 0/3 不可读：
    //   有效期已登记且未过期 → 有效
    //   有证号但到期日空      → 待补（warn，不是 bad）
    //   连证号都没有          → 缺证（bad）
    if (!hasValue(row[cert.code])) {
      certDetails.push({ label: cert.label, text: '缺证', level: 'bad' });
      continue;
    }
    const verdict = judgeDate(row[cert.expiry], today);
    if (verdict.state === 'ok' || verdict.state === 'expiring') {
      valid += 1;
      certDetails.push({ label: cert.label, text: dateText(verdict), level: verdict.state === 'ok' ? 'ok' : 'warn' });
      continue;
    }
    if (verdict.state === 'missing') {
      pending += 1;
      certDetails.push({ label: cert.label, text: '到期日未登记', level: 'warn' });
      continue;
    }
    invalid += 1;
    certDetails.push({ label: cert.label, text: dateText(verdict), level: 'bad' });
  }

  const total = PERSONNEL_CERTS.length;
  const missing = certDetails.filter((detail) => detail.text === '缺证').length;
  // 缺证 / 过期任一张都算不合规（红）；只是到期日没登记则标黄，提示需要补录而不是「没有证」
  const certLevel: ComplianceLevel = (invalid > 0 || missing > 0) ? 'bad' : pending > 0 ? 'warn' : 'ok';

  // 证书数量按「有效 / 待补 / 缺证」三段显示，只显示有值的段，避免单元格过长
  const certSegments = [`证照 ${valid}/${total}`];
  if (pending > 0) certSegments.push(`待补${pending}`);
  if (missing > 0) certSegments.push(`缺${missing}`);

  const insuranceVerdict = judgeDate(row.employerLiabilityExpiry, today);
  const insuranceLevel: ComplianceLevel = insuranceVerdict.state === 'ok'
    ? 'ok'
    : insuranceVerdict.state === 'expiring' ? 'warn' : 'bad';

  const parts: CompliancePart[] = [
    { label: '证照', text: certSegments.join(' · '), level: certLevel },
    { label: '雇主责任险', text: `保险 ${dateText(insuranceVerdict)}`, level: insuranceLevel },
    ...certDetails,
  ];
  const level: ComplianceLevel = parts.some((part) => part.level === 'bad')
    ? 'bad'
    : parts.some((part) => part.level === 'warn') ? 'warn' : 'ok';
  return {
    level,
    // 列表单元格只显示两条汇总，证书明细放悬浮提示
    text: `${certSegments.join(' · ')} · 保险 ${dateText(insuranceVerdict)}`,
    parts,
  };
}

export function vehicleCompliance(row: Record<string, unknown>, today: Date = new Date()): ComplianceSummary {
  const compulsory = judgeDate(row.compulsoryInsuranceExpiry, today);
  const commercial = judgeDate(row.commercialInsuranceExpiry, today);
  const level = worstLevel([compulsory.state, commercial.state]);
  return {
    level,
    text: `交强险 ${dateText(compulsory)} · 商业险 ${dateText(commercial)}`,
    parts: [
      { label: '交强险', text: dateText(compulsory), level: worstLevel([compulsory.state]) },
      { label: '商业险', text: dateText(commercial), level: worstLevel([commercial.state]) },
    ],
  };
}

/**
 * 油机没有约定合规口径（用户只确认了人员与车辆），所以不输出 ok/warn/bad 的业务含义，
 * 只报告「最近保养记录」的登记情况，等级仅用于颜色区分。
 */
export function generatorMaintenance(row: Record<string, unknown>, today: Date = new Date()): { text: string; level: ComplianceLevel; days: number | null } {
  // 注意：这里不能用 judgeDate —— 它是按「到期日」语义写的（未来才算有效），
  // 而「最近一次上传保养记录」是过去发生的事，套上去会把 100 天前误判成过期。
  // 这里按「距今天数」单独算：一年内算正常，超过一年标黄。
  const raw = row.lastMaintenanceUploadAt;
  if (!hasValue(raw)) return { text: '无保养记录', level: 'warn', days: null };
  const date = parseLooseDate(raw);
  if (!date) return { text: '保养日期异常', level: 'warn', days: null };
  const elapsed = Math.round((startOfDay(today).getTime() - startOfDay(date).getTime()) / DAY_MS);
  if (elapsed <= 0) return { text: '今天上传', level: 'ok', days: 0 };
  return { text: `${elapsed}天前上传`, level: elapsed > 365 ? 'warn' : 'ok', days: -elapsed };
}

export function complianceOf(kind: AssetKind, row: Record<string, unknown>, today: Date = new Date()): ComplianceSummary {
  if (kind === 'personnel') return personnelCompliance(row, today);
  if (kind === 'vehicles') return vehicleCompliance(row, today);
  const maintenance = generatorMaintenance(row, today);
  return { level: maintenance.level, text: maintenance.text, parts: [{ label: '保养记录', text: maintenance.text, level: maintenance.level }] };
}
