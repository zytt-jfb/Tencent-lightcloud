/**
 * 填报相关 DTO
 * 来源：OpenAPI YAML — Packages + Snapshots + AdminPackages tags
 */

/** 单行合同填报输入 */
export interface ContractMonthInput {
  contractId: number;
  completionAmount: number;
  acceptanceAmount: number;
  invoiceAmount: number;
  orderAmount: number;
}

/** 单行费用填报输入 */
export interface CostMonthInput {
  costCategoryCode: string;
  amount: number;
}

/** 维保填报输入（可选，按城市配置决定是否必填） */
export interface MaintenanceMonthInput {
  invoiceTotalPrevYear?: number;
  invoiceMonthCountPrevYear?: number;
  invoiceTotalCurrentYear?: number;
}

/** 草稿保存请求 */
export interface DraftSaveRequest {
  monthNo: number;
  contractRows: ContractMonthInput[];
  costRows: CostMonthInput[];
  maintenanceRow?: MaintenanceMonthInput;
}

/**
 * 统一填报数据请求体（草稿保存 / 提交预览 / 正式提交 共用）
 *
 * 设计决策：
 * - draft-save、submit-preview、submit 三个接口的操作对象相同（月度填报数据）
 * - 使用同一 DTO 避免多层嵌套，符合 REST 惯例
 * - 如需扩展可在 @Body() 外层通过 query/path 区分行为
 */
export type SubmitMonthRequest = DraftSaveRequest;

/** 提交预览响应 — 汇总校验结果与数据概览 */
export interface SubmitPreviewResponse {
  belongMonth: number;
  completionTotal: number;
  acceptanceTotal: number;
  costTotal: number;
  orderGrossProfit: number;
  grossProfit: number;
  costRate: number;
  costIncomeRate: number;
  netProfit: number;
  netProfitRate: number;
  isOverdue: boolean;
}

// ============================================================
// 管理员包操作 DTO
// ============================================================

/** 退回草稿请求 */
export interface ReturnToDraftRequest {
  monthNo: number;
  reason: string;
}

/** 解锁历史月份请求 */
export interface UnlockMonthsRequest {
  months: number[];
  expiresAt: string;     // ISO date-time
  reason?: string | null;
}

/** 批量解锁全部地市指定月份请求 */
export interface BulkUnlockMonthsRequest extends UnlockMonthsRequest {
  year?: number;
}

/** 批量解锁全部地市指定月份响应 */
export interface BulkUnlockMonthsResponse {
  success: boolean;
  message: string;
  packageCount: number;
  createdGrantCount: number;
  skippedActiveGrantCount: number;
  unlockedMonths: number[];
}

/** 开放当月新增合同填报权限请求 */
export interface OpenCurrentMonthContractRequest {
  monthNo: number;
  contractId: number;
}
