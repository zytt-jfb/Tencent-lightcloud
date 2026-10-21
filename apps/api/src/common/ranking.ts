/**
 * 排名公共件
 *
 * 业务含义：标准竞赛排名（并列同名次、跳号）——「比我高的人数 + 1」。
 * 后评估成绩单与月度考核原本各写了一份，算法相同、实现不同：
 *  - 后评估：`rankDesc(values, target)`，带 1e-9 容差（浮点相加的尾差不算超过）
 *  - 月度考核：`values.filter(other => other.score > item.score).length + 1`，无容差
 * 二者数学上一致，唯一差别就是容差，所以这里把它做成参数，默认沿用后评估的 1e-9，
 * 月度考核传 0 保持原行为不变（口径不合并，参数显式化）。
 *
 * 注意：分母（参与排名的集合）由各自的业务口径决定，本函数只算名次，不做筛选。
 */
export function rankDesc(values: number[], target: number, epsilon = 1e-9): number | null {
  if (values.length === 0) return null;
  const better = values.filter((value) => value > target + epsilon).length;
  return better + 1;
}
