import type { Intent, IntentParamSpec } from './intent.types';

/**
 * 轻量参数抽取（正则 + 值列表匹配，**不是 NLP**）
 *
 * 设计取舍：宁可「抽不到就问用户」，也不猜。
 * 猜错的后果比多问一句严重得多——用户会以为系统算错了。
 */

export interface ParamExtractContext {
  /** 地市名字典（来自 biz_cities.name，含「市」后缀） */
  cityNames: string[];
}

export interface ParamExtractResult {
  params: Record<string, string | number | null>;
  /** 缺失的必填参数（用于返回「请补充 XX」而不是硬跑一个错查询） */
  missing: Array<{ name: string; label: string }>;
}

/** 全角转半角 + 压缩空白：用户从 Excel 复制过来的问句常带全角数字 */
export function toHalfWidth(input: string): string {
  return input
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 同义词归一：把口语说法替换成触发词。
 * 按 key 长度倒序替换，否则「排名环比」会先被「排名」吃掉，导致更长的词永远匹配不上。
 */
export function normalizeInput(input: string, synonyms: Record<string, string> = {}): string {
  const base = toHalfWidth(input).toLowerCase();
  const keys = Object.keys(synonyms).sort((a, b) => b.length - a.length);
  let result = base;
  for (const key of keys) {
    result = result.split(key.toLowerCase()).join(synonyms[key].toLowerCase());
  }
  return result;
}

/** 从输入里找地市名；返回词典里的标准写法 */
export function findCityInInput(input: string, cityNames: readonly string[]): string | null {
  let best: string | null = null;
  for (const name of cityNames) {
    if (!name) continue;
    const short = name.replace(/(市|地区|自治州|盟)$/u, '');
    const hit = input.includes(name) || (short.length >= 2 && input.includes(short));
    if (hit && (!best || name.length > best.length)) best = name;
  }
  return best;
}

/** 抽取「YYYY-MM」形式的月份（支持 2026-09 / 2026年9月 / 2026.9） */
export function findMonthsInInput(input: string): string[] {
  const result: string[] = [];
  const re = /(20\d{2})\s*[-年/.]\s*(\d{1,2})/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    const month = Number.parseInt(match[2], 10);
    if (month >= 1 && month <= 12) result.push(`${match[1]}-${String(month).padStart(2, '0')}`);
  }
  return [...new Set(result)];
}

export function findYearInInput(input: string): number | null {
  const match = /\b(20\d{2})\b/.exec(input);
  return match ? Number.parseInt(match[1], 10) : null;
}

export function findDaysInInput(input: string): number | null {
  const match = /(\d{1,3})\s*天/.exec(input);
  if (!match) return null;
  const days = Number.parseInt(match[1], 10);
  return days > 0 && days <= 365 ? days : null;
}

/**
 * 枚举参数：从问句里认出属于哪一类。
 * 先按别名（长词优先，避免「车辆保养」被「车辆」抢走），再按值本身匹配。
 * 认不出来返回 null，由 applyDefaults 决定是否走默认值 —— 不猜。
 */
function matchEnum(spec: IntentParamSpec, input: string): string | null {
  const bucket = spec.enum;
  if (!bucket) return null;
  const aliases = Object.entries(bucket.aliases ?? {}).sort((a, b) => b[0].length - a[0].length);
  for (const [alias, value] of aliases) {
    if (input.includes(alias.toLowerCase())) return value;
  }
  for (const value of bucket.values) {
    if (input.includes(value.toLowerCase())) return value;
  }
  return null;
}

function extractOne(spec: IntentParamSpec, input: string, ctx: ParamExtractContext): string | number | null {
  if (spec.enum) return matchEnum(spec, input);
  if (spec.from === 'city_dictionary') return findCityInInput(input, ctx.cityNames);
  if (spec.from === 'month') {
    const months = findMonthsInInput(input);
    return months.length > 0 ? months[months.length - 1] : null;
  }
  if (spec.from === 'year') return findYearInInput(input);
  if (spec.from === 'days') return findDaysInInput(input);
  if (spec.from === 'month_range') {
    // 区间由调用方从同一个数组里取两段，这里返回第一段，第二段在下方特殊处理
    const months = findMonthsInInput(input);
    return months.length > 0 ? months[0] : null;
  }
  if (spec.pattern) {
    const match = spec.pattern.exec(input);
    if (!match) return null;
    return match[1] ?? match[0];
  }
  return null;
}

export function extractParams(
  intent: Intent,
  rawInput: string,
  ctx: ParamExtractContext,
): ParamExtractResult {  const input = toHalfWidth(rawInput).toLowerCase();
  const params: Record<string, string | number | null> = {};
  const missing: Array<{ name: string; label: string }> = [];

  for (const [name, spec] of Object.entries(intent.params)) {
    if (spec.from === 'month_range') {
      const months = findMonthsInInput(input);
      if (months.length === 0) {
        params[`${name}From`] = null;
        params[`${name}To`] = null;
      } else {
        params[`${name}From`] = months[0];
        params[`${name}To`] = months.length > 1 ? months[months.length - 1] : months[0];
      }
      continue;
    }
    const value = extractOne(spec, input, ctx);
    params[name] = value;
    // enum 的默认值挂在 spec.enum 上，不算「没给默认」，否则派生字段会被误判为缺参
    const hasDefault = Boolean(spec.defaultValue) || Boolean(spec.enum?.defaultValue);
    if (value === null && spec.required && !hasDefault) {
      missing.push({ name, label: spec.label ?? name });
    }
  }

  return { params, missing };
}

/**
 * 推导 SQL 里 `?` 的参数顺序。
 *
 * 为什么靠「声明顺序」而不是给每条 SQL 单独写一份参数名列表：
 *   两处维护必然漂移（改了 params 忘了改列表，查询就静默错位，比报错难查一万倍）。
 *   这里把顺序定义为「intent.params 的声明顺序，month_range 展开成 From/To」，
 *   并在注册表启动时断言「SQL 的占位符个数 == 推导出的参数个数」，
 *   一旦不匹配直接剔除该意图，不会带着错位的参数上线。
 */
export function deriveParamNames(intent: Intent): string[] {
  const names: string[] = [];
  for (const [name, spec] of Object.entries(intent.params)) {
    if (spec.from === 'month_range') {
      names.push(`${name}From`, `${name}To`);
    } else {
      names.push(name);
    }
  }
  return names;
}
