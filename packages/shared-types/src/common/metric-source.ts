export const V3_METRIC_SOURCE_MANIFEST = Object.freeze({
  version: 'v3-facts-unified-2026-07-29',
  legacyPackageLifecycle: Object.freeze({
    mode: 'read_only_compatibility',
    tables: Object.freeze(['annual_report_packages', 'report_contract_monthly_rows', 'report_cost_monthly_rows']),
    allowedMetrics: Object.freeze(['completionAmount', 'acceptanceAmount', 'invoiceAmount', 'costBudget', 'maintenanceBudget']),
    prohibitedMetrics: Object.freeze(['orderAmount', 'actualCost']),
    exitCondition: '合同月度进度、成本预算和综合代维预算完成独立事实表迁移，并通过隔离 MySQL、浏览器与导出验收',
    exitPlan: Object.freeze([
      '停止旧报表包写入口并保留只读查询窗口',
      '迁移合同月度进度、预算与综合代维预算至独立事实表',
      '切换统一聚合服务后移除 annual_report_packages 运行时依赖',
    ]),
  }),
  dashboard: Object.freeze({
    completionAmount: 'report_contract_monthly_rows.completion_amount (read-only compatibility)',
    acceptanceAmount: 'report_contract_monthly_rows.acceptance_amount (read-only compatibility)',
    invoiceAmount: 'report_contract_monthly_rows.invoice_amount (read-only compatibility)',
    orderAmount: 'order_facts.tax_inclusive_amount',
    actualCost: 'cost_facts.amount',
    grossProfit: 'acceptanceAmount * contract_city_allocations.rate',
    actualNetProfit: 'grossProfit - actualCost',
  }),
  cityEstimate: Object.freeze({
    contractProgress: 'GET /admin/facts/progress -> report_contract_monthly_rows (read-only compatibility)',
    orderAmount: 'GET /admin/facts/orders -> order_facts.tax_inclusive_amount',
    actualCost: 'GET /admin/facts/costs -> cost_facts.amount',
    costBudget: 'report_cost_monthly_rows.amount (read-only compatibility)',
    contractMetadata: 'contracts/contract_city_allocations',
    lifecycle: 'read_only_compatibility',
  }),
} as const);

export type V3MetricSourceManifest = typeof V3_METRIC_SOURCE_MANIFEST;
