/**
 * 组织名称别名
 *
 * 背景：维护管理三张表和月度考核绩效表，同一地市存的名字不一样
 * （维护表存「东营市」，绩效表存「东营」），而账号数据范围里是地市 UUID。
 * 把 UUID 换成名称去过滤时，必须同时试「标准名」和「去掉『市』后缀」两种写法。
 *
 * 注意：只剥「市」。像「广饶县」这类本身以县结尾的独立经营单元不能剥，
 * 否则会和别的县撞名。
 */
export function cityAliases(name: string | null | undefined): string[] {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return [];
  const aliases = [trimmed];
  if (trimmed.endsWith('市')) aliases.push(trimmed.slice(0, -1));
  return aliases;
}
