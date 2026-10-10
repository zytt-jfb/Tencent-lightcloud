export interface BusinessProfitMetrics {
  costRate: number;
  costIncomeRate: number;
  netProfit: number;
  netProfitRate: number;
}

export function calculateProfitMetrics(
  completionTotal: number,
  costTotal: number,
  orderGrossProfit: number,
): BusinessProfitMetrics {
  const netProfit = orderGrossProfit - costTotal;
  return {
    costRate: safeDivide(costTotal, completionTotal),
    costIncomeRate: safeDivide(costTotal, orderGrossProfit),
    netProfit,
    netProfitRate: safeDivide(netProfit, completionTotal),
  };
}

function safeDivide(numerator: number, denominator: number): number {
  if (!Number.isFinite(denominator) || denominator === 0) return 0;
  const result = numerator / denominator;
  return Number.isFinite(result) ? result : 0;
}
