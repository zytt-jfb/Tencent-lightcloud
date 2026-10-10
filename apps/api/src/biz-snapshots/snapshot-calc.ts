/**
 * 快照计算纯函数（无 DB / 无 auth 依赖，便于单元测试）。
 *
 * 设计要点：
 *  - 所有"是否到期""月份枚举""范围匹配"逻辑集中于此，快照生成与 dashboard 读取共用；
 *  - 快照生成为全局计算（不接收任何用户上下文），dashboard 读取时再用 scopeMatch 按请求用户过滤。
 */

/** 数据范围（与 RbacService.ResolvedDataScope 结构一致，仅取过滤所需字段） */
export interface ScopeLike {
  scopeType: 'all' | 'province' | 'city' | 'contract' | 'mixed' | 'none';
  provinceIds: string[];
  cityId: string | null;
  cityIds?: string[];
  contractIds?: string[];
  allowAll?: boolean;
  deniedProvinceIds?: string[];
  deniedCityIds?: string[];
  deniedContractIds?: string[];
}

/** 合同快照行（用于分摊合同额、统计合同数） */
export interface ContractSnapLike {
  contractId: string;
  provinceId: string | null;
  cityId: string;
  contractAmountFen: number;
  quotaFen: number;
  isExpiredAtAsOf: number;
}

export interface Bucket {
  orderCompletionFen: number;
  offlineCompletionFen: number;
  grossProfitFen: number;
  costFen: number;
  netProfitFen: number;
}

export function zeroBucket(): Bucket {
  return { orderCompletionFen: 0, offlineCompletionFen: 0, grossProfitFen: 0, costFen: 0, netProfitFen: 0 };
}

/**
 * 到期判断：endDate 早于参考日即视为已到期。
 * 日期以 YYYY-MM-DD 字符串比较（字典序等价于时间序）。
 * endDate 为空 → 未到期（库存仍计入合同数）。
 */
export function isExpiredAt(endDate: string | null | undefined, ref: string): boolean {
  if (!endDate) return false;
  return endDate < ref;
}

/** 月末最后一天（输入 YYYY-MM），返回 YYYY-MM-DD */
export function lastDayOfMonth(month: string): string {
  const [y, mm] = month.split('-').map(Number);
  const d = new Date(y, mm, 0);
  return `${y}-${String(mm).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 最近 n 个月（含 asOf 所在月），升序，格式 YYYY-MM */
export function lastNMonths(asOf: string, n: number): string[] {
  const [y, mm] = asOf.slice(0, 7).split('-').map(Number);
  const out: string[] = [];
  // 从 (y, mm - n + 1) 起算，逐月 +1
  let cur = new Date(y, mm - 1 - (n - 1), 1);
  for (let i = 0; i < n; i++) {
    const yy = cur.getFullYear();
    const mth = cur.getMonth() + 1;
    out.push(`${yy}-${String(mth).padStart(2, '0')}`);
    cur = new Date(yy, mth, 1);
  }
  return out;
}

/**
 * 数据范围匹配：判断某条（省/市）维度数据是否对当前请求用户可见。
 *  - all/contract：全部可见（contract 由上游权限守卫拦截，这里不额外过滤）
 *  - province：provinceIds 为空=全部省份，否则需在列表内
 *  - city：必须精确等于绑定地市
 * 注意：只按 auth.dataScope 过滤，绝不信任请求参数。
 */
export function scopeMatch(scope: ScopeLike, provinceId: string | null, cityId: string | null): boolean {
  const deniedProvinceIds = scope.deniedProvinceIds ?? [];
  const deniedCityIds = scope.deniedCityIds ?? [];
  if (provinceId && deniedProvinceIds.includes(provinceId)) return false;
  if (cityId && deniedCityIds.includes(cityId)) return false;
  if (scope.allowAll || scope.scopeType === 'all') return true;
  if (scope.scopeType === 'province' && scope.provinceIds.length > 0) return !!provinceId && scope.provinceIds.includes(provinceId);
  if (scope.scopeType === 'city') return !!cityId && (scope.cityIds?.includes(cityId) ?? cityId === scope.cityId);
  return false;
}

/**
 * 从合同快照行计算库存指标：
 *  - count：去重合同数（到期合同仍计入合同数量）
 *  - amountFen：经营金额 = 未到期合同按地市配额分摊的合同额之和
 *    （与 byCity 同一口径：share = 该地市配额 / 合同总配额；总配额取全局分配合计）
 *
 * @param scopedSnaps 已按用户范围过滤后的合同快照行
 * @param allSnaps    全局合同快照行（用于计算合同总配额，避免跨范围泄露/误算）
 */
export function computeInventory(scopedSnaps: ContractSnapLike[], allSnaps: ContractSnapLike[]): { count: number; amountFen: number } {
  const totalQuotaByContract = new Map<string, number>();
  for (const s of allSnaps) {
    totalQuotaByContract.set(s.contractId, (totalQuotaByContract.get(s.contractId) ?? 0) + (Number(s.quotaFen) || 0));
  }
  const countSet = new Set<string>();
  let amountFen = 0;
  for (const s of scopedSnaps) {
    countSet.add(s.contractId);
    if (s.isExpiredAtAsOf) continue; // 到期合同排除经营金额
    const total = totalQuotaByContract.get(s.contractId) || 0;
    const share = total > 0 ? (Number(s.quotaFen) || 0) / total : 0;
    amountFen += (Number(s.contractAmountFen) || 0) * share;
  }
  return { count: countSet.size, amountFen: Math.round(amountFen) };
}
