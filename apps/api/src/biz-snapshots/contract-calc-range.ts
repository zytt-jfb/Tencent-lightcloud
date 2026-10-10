/**
 * 经营分析计算范围与进度纯函数（无依赖，可独立单测）
 * 用于：合同到期口径（current/historical）、完工进度百分比、合同数按 ID 去重。
 * 这些函数不触碰数据库，便于本地 node:test 验证。
 */

export type CalcMode = 'current' | 'historical';

export interface ContractPeriod {
  id: string;
  startDate?: string | Date | null;
  endDate?: string | Date | null;
}

function toDate(v: string | Date | null | undefined): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * 合同是否在经营计算范围内。
 *
 * mode=current: 以 asOf（默认今天）判断。
 *   - endDate < asOf 的到期合同：不参与"最新"经营金额/完工/毛利/净利计算；
 *   - 但库存口径（合同数、合同额）仍计入（见 contractInventory 调用方决定是否过滤）。
 *
 * mode=historical: 以所选期间结束日 periodEnd 判断。
 *   - 合同在期间结束日仍有效（endDate >= periodEnd）则纳入该期间经营指标；
 *   - 后来到期不影响历史期间已计算的合同数/额/完工/利润。
 *
 * endDate 为空视为长期有效（永远在范围内）。
 */
export function isContractInCalculationRange(
  contract: ContractPeriod,
  periodEnd: string | Date,
  mode: CalcMode,
  asOf?: string | Date,
): boolean {
  const end = toDate(contract.endDate);
  const ref = mode === 'current' ? toDate(asOf) ?? new Date() : toDate(periodEnd);
  if (!ref) return true; // 无参考时点：保守纳入
  if (!end) return true; // 无到期日：视为长期有效
  // current: 未到期(endDate >= asOf) 纳入；historical: 期间结束日仍有效(endDate >= periodEnd) 纳入
  return end.getTime() >= ref.getTime();
}

/**
 * 完工进度百分比（保留两位小数，可超过 100%）。
 * 合同金额 <= 0 或缺失（null/undefined/NaN）返回 null（前端显示 "-"）。
 * 例：6835/10000 -> 68.35；10542/10000 -> 105.42。
 */
export function formatCompletionProgressPct(
  completionFen: number | null | undefined,
  contractAmountFen: number | null | undefined,
): number | null {
  const amt = Number(contractAmountFen);
  if (!Number.isFinite(amt) || amt <= 0) return null;
  const comp = Number(completionFen) || 0;
  const pct = (comp / amt) * 100;
  // 四舍五入保留两位小数（68.345 -> 68.35）
  return Math.round((pct + Number.EPSILON) * 100) / 100;
}

/**
 * 按合同 ID 去重，返回有序唯一 ID 列表。
 * 用于合同数统计，避免多月份 / 多地市 / 多维度重复累加同一合同。
 * 自动跳过 null/undefined/空串。
 */
export function dedupeContractIds(ids: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}
