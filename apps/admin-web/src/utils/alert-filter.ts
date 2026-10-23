/**
 * 合同预警筛选：纯函数，便于定向测试。
 *
 * 设计约束（线上 bug 修复）：
 *  - 预警类型一律使用后端枚举值：expired / expiring / nearly_full / overfull；
 *  - Select 的 value 必须是枚举值，label 仅用于显示中文，禁止用中文当筛选值；
 *  - 筛选必须严格按 selected.includes(String(row.alertType))，不模糊匹配、不互相串类型；
 *  - 同一合同允许同时存在多种预警（如 overfull + expiring），按类型过滤时互不干扰。
 */

/** 合同预警类型选项：value 为后端枚举值，label 仅用于展示 */
export const ALERT_TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'expiring', label: '即将到期' },
  { value: 'overfull', label: '已满额/超额' },
  { value: 'nearly_full', label: '接近满额' },
  { value: 'expired', label: '已到期' },
];

/** 后端枚举值集合（用于收敛脏数据） */
export const ALERT_TYPE_VALUES = ALERT_TYPE_OPTIONS.map((o) => o.value);
const ALERT_TYPE_ORDER = new Map(ALERT_TYPE_VALUES.map((value, index) => [value, index]));

export type AlertRow = Record<string, unknown>;

/** 预警类型 → 中文展示（未知值原样返回，便于发现脏数据） */
export function alertTypeLabel(value: unknown): string {
  const key = String(value ?? '');
  const hit = ALERT_TYPE_OPTIONS.find((o) => o.value === key);
  return hit ? hit.label : key;
}

/**
 * 归一化预警数据：
 *  1) 过滤掉 none / normal（不是真实预警）；
 *  2) 按 contractId + alertType + cityId 去重（不能只按合同编号去重，否则会误删同一合同的不同预警类型）。
 */
export function normalizeAlerts(items: AlertRow[] | undefined | null): AlertRow[] {
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  const out: AlertRow[] = [];
  for (const row of items) {
    const type = String(row?.alertType ?? '');
    if (!type || type === 'none' || type === 'normal') continue;
    const key = `${String(row?.contractId ?? '')}|${type}|${String(row?.cityId ?? '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/**
 * 按「合同 + 预警类型」去重，丢掉地市维度。
 *
 * 为什么需要：快照表是按「合同 × 活跃地市分配」逐行写入的，一份合同分给 N 个地市就有 N 行；
 * 经营概览要回答的是「有多少份合同要到期」，不是「有多少条地市分配」，所以只保留首次出现的那行。
 * 与 normalizeAlerts 的区别：那个含 cityId，去不掉同一合同的多地市行；这里刻意不含。
 */
export function dedupeAlertsByContract(items: AlertRow[] | undefined | null): AlertRow[] {
  if (!Array.isArray(items)) return [];
  const seen = new Set<string>();
  const out: AlertRow[] = [];
  for (const row of items) {
    const key = `${String(row?.contractId ?? '')}|${String(row?.alertType ?? '')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

/**
 * 按选中的预警类型过滤。
 *  - selected 为空数组（或未选）→ 返回全部，不做任何过滤；
 *  - 否则严格按 selected.includes(String(row.alertType))，只保留命中的类型；
 *  - 选中了某类型但该类型无数据 → 返回空数组（由调用方展示"暂无符合条件的预警"）。
 */
export function filterAlertsByTypes(items: AlertRow[], selected: string[] | undefined | null): AlertRow[] {
  const list = Array.isArray(items) ? items : [];
  const picked = Array.isArray(selected) ? selected.filter(Boolean) : [];
  if (!picked.length) return list;
  return list.filter((row) => picked.includes(String(row?.alertType ?? '')));
}

/** 组合：先归一化再去筛选（组件实际使用的入口） */
export function selectVisibleAlerts(items: AlertRow[] | undefined | null, selected: string[] | undefined | null): AlertRow[] {
  return filterAlertsByTypes(normalizeAlerts(items), selected)
    .sort((left, right) => (ALERT_TYPE_ORDER.get(String(left.alertType)) ?? Number.MAX_SAFE_INTEGER) - (ALERT_TYPE_ORDER.get(String(right.alertType)) ?? Number.MAX_SAFE_INTEGER));
}

/**
 * 到期日期比较器（列头 sorter 用）：升序，空值排最后。
 *  - 两者都有值：ISO 日期字符串直接字典序比较（'YYYY-MM-DD' 字典序 = 日期序）；
 *  - 任一方为空（null / '' / undefined）：有值的在前，空的在后；
 *  - 完全相等返回 0。
 */
export function compareEndDate(a: unknown, b: unknown): number {
  const la = a == null || a === '' ? '' : String(a);
  const ra = b == null || b === '' ? '' : String(b);
  if (la && !ra) return -1;
  if (!la && ra) return 1;
  if (la !== ra) return la < ra ? -1 : 1;
  return 0;
}

/**
 * 按到期日期升序排序（预警紧迫度：最早到期 / 已到期在前）。
 *  - endDate 为 null / 空 的排最后（不让无日期合同窜到最前）；
 *  - 同日期兜底：先按预警类型顺序（沿用 ALERT_TYPE_ORDER），再按合同编号，保证分页稳定不乱跳。
 * 返回新数组，不修改入参。供数据层使用（使表格默认序与 Excel 导出序一致）。
 */
export function sortAlertsByEndDate(items: AlertRow[] | undefined | null): AlertRow[] {
  if (!Array.isArray(items)) return [];
  const copy = items.slice();
  copy.sort((left, right) => {
    const cmp = compareEndDate(left?.endDate, right?.endDate);
    if (cmp !== 0) return cmp;
    const lt = ALERT_TYPE_ORDER.get(String(left?.alertType)) ?? Number.MAX_SAFE_INTEGER;
    const rt = ALERT_TYPE_ORDER.get(String(right?.alertType)) ?? Number.MAX_SAFE_INTEGER;
    if (lt !== rt) return lt - rt;
    const lc = String(left?.contractNo ?? '');
    const rc = String(right?.contractNo ?? '');
    return lc < rc ? -1 : lc > rc ? 1 : 0;
  });
  return copy;
}
