/**
 * 合同月度填报行
 * 来源：DDL report_contract_monthly_rows 表
 *
 * 关键设计：
 * - contract_code_snapshot / contract_name_snapshot：提交时快照化（即使原合同被删除也不影响历史数据）
 * - completion_amount ≥ acceptance_amount（审定 ≤ 完工）
 * - is_locked 标记是否被管理员锁定
 */
export interface ReportContractMonthlyRow {
  id: number;
  packageId: number;
  contractId: number | null;
  contractCodeSnapshot: string;
  contractNameSnapshot: string;
  cityAllocationId: number | null;
  monthNo: number;
  completionAmount: number;
  acceptanceAmount: number;
  invoiceAmount: number | null;
  orderAmount: number | null;
  isLocked: boolean;
  lockReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 费用月度填报行
 * 来源：DDL report_cost_monthly_rows 表
 *
 * 关键设计：
 * - 7 大费用类别各一行（cost_category_code 唯一）
 * - (package_id, month_no, cost_category_code) 唯一约束
 */
export interface ReportCostMonthlyRow {
  id: number;
  packageId: number;
  monthNo: number;
  costCategoryCode: string;
  amount: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * 维保月度填报行
 * 来源：DDL report_maintenance_monthly_rows 表
 *
 * 关键设计：
 * - 仅当对应城市的 enable_maintenance=true 时才需要填写
 * - (package_id, month_no) 唯一约束（每个包每月只有一条维保记录）
 */
export interface ReportMaintenanceMonthlyRow {
  id: number;
  packageId: number;
  monthNo: number;
  invoiceTotalPrevYear: number;
  invoiceMonthCountPrevYear: number;
  invoiceTotalCurrentYear: number;
  createdAt: Date;
  updatedAt: Date;
}
