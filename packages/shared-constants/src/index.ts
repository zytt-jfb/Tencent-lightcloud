/**
 * 经营单元上报系统 - 共享常量
 * 来源：业务规则 + DDL 约束 + OpenAPI schema
 */

import { CostCategoryCode } from '@biz-reporting/shared-types';

// ============================================================
// 费用类别定义（7 大固定类别）
// 对应：DDL report_cost_monthly_rows.cost_category_code
// ============================================================
export const COST_CATEGORIES: ReadonlyArray<{
  code: CostCategoryCode;
  label: string;       // 中文显示名（前端 + 导出 Excel 表头）
  sortOrder: number;    // 固定排序顺序
}> = [
  { code: CostCategoryCode.LABOR, label: '人工成本', sortOrder: 1 },
  { code: CostCategoryCode.UTILITIES, label: '水电费', sortOrder: 2 },
  { code: CostCategoryCode.FUEL, label: '油补', sortOrder: 3 },
  { code: CostCategoryCode.ENTERTAINMENT, label: '招待费', sortOrder: 4 },
  { code: CostCategoryCode.RENT, label: '房租', sortOrder: 5 },
  { code: CostCategoryCode.REIMBURSEMENT, label: '报销', sortOrder: 6 },
  { code: CostCategoryCode.OTHER, label: '其他', sortOrder: 7 },
] as const;

/** 获取所有有效的费用类别代码 */
export const VALID_COST_CATEGORY_CODES = COST_CATEGORIES.map((c) => c.code);

// ============================================================
// 数据校验规则矩阵
// ============================================================
export const VALIDATION_RULES = {
  /** 合同行校验 */
  contractRow: {
    completionAmount: {
      required: true,
      min: 0,
    },
    acceptanceAmount: {
      required: true,
      min: 0,
      // 业务规则：审定金额 ≤ 完工金额
      maxRefField: 'completionAmount' as const,
    },
  },
  /** 费用行校验 — 所有 7 类别必填且 ≥ 0 */
  costRow: {
    amount: {
      required: true,
      min: 0,
    },
  },
  /** 维保行校验 — 仅当城市 enable_maintenance=true 时生效 */
  maintenanceRow: {
    invoiceTotalPrevYear: { required: false, min: 0 },
    invoiceMonthCountPrevYear: { required: false, min: 0, integerOnly: true },
    invoiceTotalCurrentYear: { required: false, min: 0 },
  },
} as const;

// ============================================================
// 报表包状态机（合法状态转换）
// ============================================================
export const PACKAGE_STATUS_TRANSITIONS: ReadonlyMap<
  string,
  readonly string[]
> = new Map([
  ['draft', ['submitted']],
  ['submitted', ['draft']], // 仅管理员可退回
]);

// ============================================================
// API 路径前缀常量
// ============================================================
export const API_PREFIX = '/api' as const;

export const API_PATHS = {
  // Auth
  AUTH_ADMIN_LOGIN: `${API_PREFIX}/auth/admin/login`,
  AUTH_WECHAT_BIND: `${API_PREFIX}/auth/wechat/bind`,
  AUTH_WECHAT_LOGIN: `${API_PREFIX}/auth/wechat/login`,

  // Me
  ME: `${API_PREFIX}/me`,

  // Admin - Users
  ADMIN_USERS: `${API_PREFIX}/admin/users`,
  ADMIN_USER_STATUS: (userId: number) =>
    `${API_PREFIX}/admin/users/${userId}/status`,
  ADMIN_USER_CITY: (userId: number) =>
    `${API_PREFIX}/admin/users/${userId}/city`,

  // Admin - CityConfigs
  ADMIN_CITY_CONFIGS: `${API_PREFIX}/admin/city-configs`,
  ADMIN_CITY_CONFIG: (cityId: number) =>
    `${API_PREFIX}/admin/city-configs/${cityId}`,

  // Admin - Contracts
  ADMIN_CONTRACTS: `${API_PREFIX}/admin/contracts`,
  ADMIN_CONTRACT: (contractId: number) =>
    `${API_PREFIX}/admin/contracts/${contractId}`,
  ADMIN_CONTRACT_ALLOCATIONS: (contractId: number) =>
    `${API_PREFIX}/admin/contracts/${contractId}/allocations`,
  ADMIN_ALLOCATION: (allocationId: number) =>
    `${API_PREFIX}/admin/allocations/${allocationId}`,

  // City - Packages
  CITY_PACKAGES_CURRENT: `${API_PREFIX}/city/packages/current`,
  CITY_PACKAGE_MONTH: (packageId: number, monthNo: number) =>
    `${API_PREFIX}/city/packages/${packageId}/months/${monthNo}`,
  CITY_PACKAGE_DRAFT_SAVE: (packageId: number) =>
    `${API_PREFIX}/city/packages/${packageId}/draft-save`,
  CITY_PACKAGE_SUBMIT_PREVIEW: (packageId: number) =>
    `${API_PREFIX}/city/packages/${packageId}/submit-preview`,
  CITY_PACKAGE_SUBMIT: (packageId: number) =>
    `${API_PREFIX}/city/packages/${packageId}/submit`,

  // Snapshots (只读)
  READONLY_MONTH: (packageId: number, monthNo: number) =>
    `${API_PREFIX}/city/packages/${packageId}/read-only-months/${monthNo}`,

  // Admin - Package Control
  ADMIN_PACKAGES: `${API_PREFIX}/admin/packages`,
  ADMIN_PACKAGE_RETURN_TO_DRAFT: (packageId: number) =>
    `${API_PREFIX}/admin/packages/${packageId}/return-to-draft`,
   ADMIN_PACKAGE_UNLOCK_MONTHS: (packageId: number) =>
    `${API_PREFIX}/admin/packages/${packageId}/unlock-months`,
  ADMIN_PACKAGE_OPEN_CURRENT_CONTRACT: (packageId: number) =>
    `${API_PREFIX}/admin/packages/${packageId}/open-current-month-contract`,

  // Dashboard
  ADMIN_DASHBOARD: `${API_PREFIX}/admin/dashboard`,

  // Reminders
  ADMIN_REMINDERS_SEND: `${API_PREFIX}/admin/reminders/send`,

  // Imports
  ADMIN_IMPORTS_CONTRACTS_UPLOAD: `${API_PREFIX}/admin/imports/contracts/upload`,
  CITY_IMPORTS_REPORTING_UPLOAD: `${API_PREFIX}/city/imports/reporting/upload`,
  IMPORT_PREVIEW: (jobId: number) => `${API_PREFIX}/imports/${jobId}/preview`,
  IMPORT_CONFIRM: (jobId: number) => `${API_PREFIX}/imports/${jobId}/confirm`,

  // Exports
  EXPORTS: `${API_PREFIX}/exports`,
  EXPORT_DETAIL: (jobId: number) => `${API_PREFIX}/exports/${jobId}`,

  // Recalc Tasks
  ADMIN_RECALC_TASKS: `${API_PREFIX}/admin/recalc-tasks`,
  ADMIN_RECALC_TASK_RETRY: (taskId: number) =>
    `${API_PREFIX}/admin/recalc-tasks/${taskId}/retry`,

  // Operation Logs
  ADMIN_OPERATION_LOGS: `${API_PREFIX}/admin/operation-logs`,
} as const;

// ============================================================
// 默认分页参数
// ============================================================
export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

// ============================================================
// JWT Token 配置
// ============================================================
export const JWT_CONFIG = {
  EXPIRES_IN: '8h',
} as const;

// ============================================================
// 小程序端常量
// ============================================================
export const MINIAPP_TAB_BAR = {
  PAGES: ['/pages/index/index', '/pages/report/report', '/pages/messages/messages', '/pages/profile/profile'],
  LIST: ['首页', '填报', '消息', '我的'],
} as const;
