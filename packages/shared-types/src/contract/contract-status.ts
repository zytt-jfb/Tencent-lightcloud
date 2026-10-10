/**
 * 合同"有效展示状态"计算 —— 前端/后端共享的唯一权威实现。
 *
 * 背景：合同库只保存主状态（draft/active/completed/voided），"已到期"是据到期日 + 判断基准日
 * 推导出的展示状态（等效附加标签），主状态字段永不改写。为避免每个页面各自写日期判断，把
 * 唯一规则收敛到这里：
 *
 *   computeEffectiveContractStatus(status, endDate, asOf)
 *   -> voided 已作废 / completed 已完成 / draft 待生效 / cancelled 已取消 原样返回（到期日不改变其展示）；
 *   -> active：endDate 严格早于 asOf（YYYY-MM-DD 字典序）→ 'expired'(已到期)，否则 → 'active'(执行中)；
 *       到期日为空 / asOf 为空 / 到期日当天 → 仍 'active'。
 *   -> 其余未知/空主状态：已到期时给 'expired'，否则原样透传（无状态则 undefined，前端按 status 显示 '-'）。
 *
 * 日期语义：endDate 与 asOf 均为 'YYYY-MM-DD' 字符串，字典序 == 时间序，天然规避浏览器/服务器时区偏差。
 */

/** 合同"有效展示状态"取值（主状态 + 推导出的已到期 + 兼容的已取消） */
export type EffectiveContractStatus = 'draft' | 'active' | 'expired' | 'completed' | 'voided' | 'cancelled';

/**
 * 依据 主状态 + 到期日 + 判断基准日 计算"有效展示状态"（纯函数，不落库、不改主状态）。
 *
 * @param status  合同主状态（draft/active/completed/voided/...，可为空）
 * @param endDate 合同到期日 'YYYY-MM-DD'（可为空）
 * @param asOf    判断基准日 'YYYY-MM-DD'（快照页用快照 asOf；实时页用服务端当日）
 */
export function computeEffectiveContractStatus(
  status: string | null | undefined,
  endDate: string | null | undefined,
  asOf: string | null | undefined,
): EffectiveContractStatus | undefined {
  const st = (status ?? '').trim().toLowerCase() || undefined;

  // 终态 / 草稿 / 已取消 / 已标记到期：到期日不改变其展示状态
  // （completed 合同即使 endDate 早于 today，也必须显示"已完成"，不得显示"已到期"）
  if (st === 'voided' || st === 'completed' || st === 'draft' || st === 'cancelled' || st === 'expired') {
    return st as EffectiveContractStatus;
  }

  // 到期判定：endDate 严格早于 asOf 才算已到期；当天仍视为执行中；任一日为空不判到期
  const isExpired = !!endDate && !!asOf && endDate < asOf;

  if (st === 'active') {
    return isExpired ? 'expired' : 'active';
  }
  if (!st) {
    // 无主状态但已到期 → 已到期；否则交给前端按 status 显示 '-'
    return isExpired ? 'expired' : undefined;
  }
  // 其余未知主状态：原样透传
  return st as EffectiveContractStatus;
}

/** 合同状态中文文案（展示层统一，key 与 computeEffectiveContractStatus 返回值一致） */
export const CONTRACT_STATUS_TEXT: Record<string, string> = {
  draft: '待生效',
  active: '执行中',
  expired: '已到期',
  completed: '已完成',
  voided: '已作废',
  cancelled: '已取消',
};
