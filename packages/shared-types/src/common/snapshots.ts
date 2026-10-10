import { ApiResponse } from './base';

/**
 * 月度解锁授权
 * 来源：DDL month_unlock_grants 表
 *
 * 管理员为城市用户临时开放已关闭月份的编辑窗口
 */
export interface MonthUnlockGrant {
  id: number;
  packageId: number;
  monthNo: number;
  expiresAt: Date;
  grantedBy: number;
  reason: string | null;
  createdAt: Date;
}

/**
 * 月度快照
 * 来源：DDL month_snapshots 表
 *
 * 核心概念：
 * - 用户点"提交"时生成当月的不可变快照
 * - summary_json / contract_rows_json / cost_rows_json / maintenance_rows_json 为 denormalized JSON
 * - (package_id, belong_month) 唯一约束 — 同一月多次提交后者覆盖前者
 */
export interface MonthSnapshot {
  id: number;
  packageId: number;
  cityId: number;
  reportYear: number;
  belongMonth: number;
  actualSubmittedAt: Date;
  isOverdue: boolean;
  summaryJson: ApiResponse<SnapshotSummaryData>;
  contractRowsJson: unknown[]; // ReportContractMonthlyRow[]
  costRowsJson: unknown[];     // ReportCostMonthlyRow[]
  maintenanceRowsJson: unknown[] | null; // ReportMaintenanceMonthlyRow[] | null
  createdBy: number;
  createdAt: Date;
  updatedAt: Date;
}

/** 快照 summary_json 内部结构（业务层约定） */
export interface SnapshotSummaryData {
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
