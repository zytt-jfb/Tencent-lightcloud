/**
 * 经营单元上报系统 - 共享枚举定义
 * 数据来源：biz-reporting-mysql-ddl.sql + biz-reporting-openapi-initial.yaml
 */

// ============================================================
// 角色枚举（来自 OpenAPI schemas.Role）
// ============================================================
export enum Role {
  /** 唯一最高权限账号 */
  ROOT_ADMIN = 'root_admin',
  /** 合同与合同地市分配管理员 */
  CONTRACT_MANAGER = 'contract_manager',
  /** 城市用户（微信登录） */
  CITY_USER = 'city_user',
  /** 系统管理员（账号密码登录） */
  SYSTEM_ADMIN = 'system_admin',
}

// ============================================================
// 权限代码（服务端 Guard、前端菜单与验收矩阵共用）
// ============================================================
export enum Permission {
  ME_READ = 'me.read',
  ME_PASSWORD_UPDATE = 'me.password.update',
  AUTH_LOGOUT = 'auth.logout',
  CITIES_READ = 'cities.read',
  CITIES_MANAGE = 'cities.manage',
  ACCOUNTS_READ = 'accounts.read',
  ACCOUNTS_CREATE = 'accounts.create',
  ACCOUNTS_UPDATE = 'accounts.update',
  ACCOUNTS_RESET_PASSWORD = 'accounts.reset_password',
  CONTRACTS_READ = 'contracts.read',
  CONTRACTS_CREATE = 'contracts.create',
  CONTRACTS_UPDATE = 'contracts.update',
  CONTRACTS_SOFT_DELETE = 'contracts.soft_delete',
  CONTRACTS_PURGE = 'contracts.purge',
  CONTRACT_ALLOCATIONS_READ = 'contract_allocations.read',
  CONTRACT_ALLOCATIONS_CREATE = 'contract_allocations.create',
  CONTRACT_ALLOCATIONS_UPDATE = 'contract_allocations.update',
  CONTRACT_ALLOCATIONS_DELETE = 'contract_allocations.delete',
  DASHBOARD_READ = 'dashboard.read',
  PROVINCE_OPERATIONS = 'province.operations',
  CITY_DATA_READ = 'city_data.read',
  CITY_DATA_WRITE = 'city_data.write',
  CITY_IMPORT = 'city_data.import',
  PROVINCE_FACTS_READ = 'province_facts.read',
  EXPORT_CITY = 'exports.city',
  EXPORT_PROVINCE = 'exports.province',
  EXPORT_AUDIT = 'exports.audit',
  OPERATION_LOGS_READ = 'operation_logs.read',
}

// ============================================================
// 用户状态枚举（来自 OpenAPI schemas.UserStatus + DDL users.status）
// ============================================================
export enum UserStatus {
  ENABLED = 'enabled',
  DISABLED = 'disabled',
}

// ============================================================
// 年度报表包状态枚举（来自 OpenAPI schemas.PackageStatus + DDL annual_report_packages.status）
// ============================================================
export enum PackageStatus {
  /** 草稿态（可编辑） */
  DRAFT = 'draft',
  /** 已提交（只读，生成快照） */
  SUBMITTED = 'submitted',
}

// ============================================================
// 合同行锁定状态（来自 DDL report_contract_monthly_rows.is_locked）
// ============================================================
export enum ContractRowLockStatus {
  UNLOCKED = 0,
  LOCKED = 1,
}

// ============================================================
// 软删除标记（来自 DDL contracts.is_deleted）
// ============================================================
export enum SoftDeleteFlag {
  NOT_DELETED = 0,
  DELETED = 1,
}

// ============================================================
// 导入/导出/重算任务状态（通用，来自 DDL 各 *_jobs / recalc_tasks .status 字段）
// ============================================================
export enum JobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  PREVIEWED = 'previewed',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

// ============================================================
// 导入任务类型（来自 DDL import_jobs.job_type）
// ============================================================
export enum ImportJobType {
  CONTRACT = 'contract',
  CITY_REPORTING = 'city_reporting',
  CITY_COST = 'city_cost',
}

// ============================================================
// 导出模式（来自 OpenAPI CreateExportJobRequest.exportMode）
// ============================================================
export enum ExportMode {
  /** 当前实时数据 */
  CURRENT_REALTIME = 'current_realtime',
  /** 月度快照数据 */
  MONTH_SNAPSHOT = 'month_snapshot',
}

// ============================================================
// 导出范围类型（来自 OpenAPI CreateExportJobRequest.scopeType）
// ============================================================
export enum ExportScopeType {
  /** 指定城市 */
  CITY = 'city',
  /** 所有城市 */
  ALL_CITIES = 'all_cities',
}

// ============================================================
// 快照范围（来自 OpenAPI CreateExportJobRequest.snapshotRange）
// ============================================================
export enum SnapshotRange {
  /** 仅当月 */
  MONTH_ONLY = 'month_only',
  /** 年初至当月 */
  YEAR_TO_MONTH = 'year_to_month',
}

// ============================================================
// 重算模式（来自 OpenAPI RetryRecalcTaskRequest.retryMode）
// ============================================================
export enum RecalcRetryMode {
  FULL = 'full',
  FAILED_ONLY = 'failed_only',
}

// ============================================================
// 提醒触发类型（冻结值，来自 DDL reminder_logs.trigger_type）
//
// 值域说明（与冻结 DTO 清单严格一致）：
//   auto    — 系统自动触发（含截止日期提醒、逾期提醒等定时场景）
//   manual  — 管理员手动触发的即时提醒
// ============================================================
export enum ReminderTriggerType {
  AUTO = 'auto',
  MANUAL = 'manual',
}

// ============================================================
// 提醒发送状态（来自 DDL reminder_logs.status）
// ============================================================
export enum ReminderSendStatus {
  PENDING = 'pending',
  SENT = 'sent',
  FAILED = 'failed',
}

// ============================================================
// 消息类型（冻结值，来自 DDL messages.message_type）
// ============================================================
export enum MessageType {
  REMINDER = 'reminder',
  SUBMIT_SUCCESS = 'submit_success',
  RETURN_TO_DRAFT = 'return_to_draft',
  SYSTEM_NOTICE = 'system_notice',
}

// ============================================================
// 费用类别代码（7 大固定类别 — 冻结值，来自业务规则 + DDL report_cost_monthly_rows.cost_category_code）
// ============================================================
export enum CostCategoryCode {
  LABOR = 'labor',
  UTILITIES = 'utilities',
  FUEL = 'fuel',
  ENTERTAINMENT = 'entertainment',
  RENT = 'rent',
  REIMBURSEMENT = 'reimbursement',
  OTHER = 'other',
}

// ============================================================
// 月份数值约束（业务规则）
// ============================================================
export const MONTH_MIN = 1;
export const MONTH_MAX = 12;
export type MonthNoType = number; // 1-12
