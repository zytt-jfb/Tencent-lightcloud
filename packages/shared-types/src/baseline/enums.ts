/**
 * 维护管理经营数据中台（新基线）— 共享枚举
 * 来源：01-产品需求基线、02-角色与权限矩阵、03-指标字典、04-业务状态机（当前确认版）
 * 命名前缀：PlatformRole / Biz* 等，避免与旧模型枚举（Role/PackageStatus 等）冲突。
 * 约束：所有业务月份保存为 'YYYY-MM' 字符串；金额统一为整数分；费率统一为整数基点。
 */

// ============================================================
// 四类默认角色（基线 02 角色定义 + 04 权限裁决）
// ============================================================
export enum PlatformRole {
  /** 系统最高权限与授权人：全部模块/功能/数据 + 授权能力 */
  SUPER_ADMIN = 'super_admin',
  /** 省级领导/运营管理员：全部省份，一次只查看单一省份 */
  ADMIN = 'admin',
  /** 合同资料与分配维护人员：仅合同域 */
  CONTRACT_MANAGER = 'contract_manager',
  /** 地市填报与本地查询人员：永久绑定单一地市 */
  CITY_USER = 'city_user',
}

export const PLATFORM_ROLES: readonly PlatformRole[] = [
  PlatformRole.SUPER_ADMIN,
  PlatformRole.ADMIN,
  PlatformRole.CONTRACT_MANAGER,
  PlatformRole.CITY_USER,
];

// ============================================================
// 合同主状态（基线 04 TABLE 1-2；已到期/即将到期等为附加标签，不替代主状态）
// ============================================================
export enum ContractStatus {
  /** 资料可不完整，尚未生效 */
  DRAFT = 'draft',
  /** 资料完整、生效并可执行（基线表 2 由"生效"转入） */
  ACTIVE = 'active',
  /** 达到 100% 且管理员确认完成 */
  COMPLETED = 'completed',
  /** 合同终止，保留历史查看 */
  VOIDED = 'voided',
}

/** 合同附加标签（可多个，不替代主状态） */
export enum ContractTag {
  /** 当前日期进入到期阈值（默认提前 3 个月）且未超过结束日期 */
  EXPIRING = 'expiring',
  /** 当前日期晚于合同结束日期 */
  EXPIRED = 'expired',
  /** 90% ≤ 进度 < 100% */
  NEARLY_FULL = 'nearly_full',
  /** 进度 ≥ 100%（满额/超额） */
  OVERFULL = 'overfull',
  /** 进度 ≥ 100% 且管理员未确认完成 */
  PENDING_COMPLETE = 'pending_complete',
  /** 已完成合同因作废跌破 100%，提示管理员手工处理 */
  PROGRESS_CHANGED = 'progress_changed',
}

/** 合同作废时的汇总选择（基线 03 8.2） */
export enum VoidSummaryChoice {
  /** 从当前汇总剔除：金额/完工/利润/预警全部移除 */
  EXCLUDE_CURRENT = 'exclude_current',
  /** 保留历史汇总：作废前贡献保留，合同不再新增业务 */
  RETAIN_HISTORY = 'retain_history',
}

// ============================================================
// 地市分配状态（基线 04 3）
// ============================================================
export enum AllocationStatus {
  ACTIVE = 'active',
  /** 仅 super_admin 取消；历史数据保留，禁止该地市新增业务 */
  CANCELLED = 'cancelled',
}

// ============================================================
// 订单批次状态（基线 04 4.1）
// ============================================================
export enum OrderBatchStatus {
  /** 后台解析/校验中 */
  PARSING = 'parsing',
  /** 全量校验通过，34 列原始行整批入账并生效 */
  IMPORTED = 'imported',
  /** 结构/必要映射错误，整批零写入 */
  FAILED = 'failed',
  /** 仅 super_admin 整批作废 */
  VOIDED = 'voided',
}

// ============================================================
// 线下完工状态机（基线 04 5）
// ============================================================
export enum OfflineCompletionStatus {
  DRAFT = 'draft',
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  VOIDED = 'voided',
}

// ============================================================
// 月度成本状态机（基线 04 6）
// ============================================================
export enum CostStatus {
  DRAFT = 'draft',
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  VOIDED = 'voided',
}

// ============================================================
// 两级超额标识（基线 01 4.5 / 03 7.1；可同时存在）
// ============================================================
export enum OverrunFlag {
  NONE = 'none',
  /** 仅超过地市固定分配额度 */
  CITY_OVERRUN = 'city_overrun',
  /** 仅超过合同总额 */
  CONTRACT_OVERRUN = 'contract_overrun',
  /** 同时超过地市额度和合同总额 */
  DUAL_OVERRUN = 'dual_overrun',
}

// ============================================================
// 合同预警类型（基线 03 7.3-7.4）
// ============================================================
export enum ContractAlertType {
  NEARLY_FULL = 'nearly_full',
  OVERFULL = 'overfull',
  EXPIRING = 'expiring',
  EXPIRED = 'expired',
}

// ============================================================
// 站内消息类型（基线 01 11）
// ============================================================
export enum BizMessageType {
  CONTRACT_ALERT = 'contract_alert',
  TODO = 'todo',
  IMPORT_RESULT = 'import_result',
  AGGREGATE_FAILURE = 'aggregate_failure',
  PERMISSION_CHANGE = 'permission_change',
}

/** 汇总异常状态（基线 01 5.6 / 07 6.3） */
export enum AggregateFailureStatus {
  OPEN = 'open',
  RECALCULATED = 'recalculated',
}

/** 重算任务状态（基线 07 6.3） */
export enum RecalcTaskStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  DONE = 'done',
  FAILED = 'failed',
}

/** 重算范围类型（基线 07 6.3：默认只重算失败范围；全量重算需二次确认） */
export enum RecalcScopeType {
  FAILED_ONLY = 'failed_only',
  FULL = 'full',
}

/** 敏感订单数据权限（基线 01 10.3 / 05 5） */
export enum SensitiveOrderDataScope {
  /** 可查看/导出完整手机号与地址 */
  FULL = 'full',
  /** 查看/导出脱敏值 */
  MASKED = 'masked',
}
