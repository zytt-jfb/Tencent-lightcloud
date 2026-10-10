/**
 * 维护管理经营数据中台（新基线）— 模块与权限码常量
 * 来源：02-角色与权限矩阵-v1.1（TABLE 2-7 页面与动作矩阵）+ 06-页面信息架构
 * 约定：权限码格式 <模块>.<页面>.<动作>；super_admin 由服务端通配（不依赖种子）。
 */

// ============================================================
// 模块编码（biz_modules.code）
// ============================================================
export const BizModuleCode = {
  ENGINEERING: 'engineering',
  MAINTENANCE: 'maintenance',
  OPERATION: 'operation',
  ASSET: 'asset',
  PERSONNEL: 'personnel',
} as const;
export type BizModuleCodeValue = (typeof BizModuleCode)[keyof typeof BizModuleCode];

// ============================================================
// 经营管理权限码（operation.*）
// ============================================================
export const BizPermissionCode = {
  // 一级门户
  PORTAL_ENGINEERING_ENTER: 'portal.engineering.enter',
  PORTAL_MAINTENANCE_ENTER: 'portal.maintenance.enter',
  // 维护管理二级门户
  MAINTENANCE_OPERATION_ENTER: 'maintenance.operation.enter',
  MAINTENANCE_ASSET_ENTER: 'maintenance.asset.enter',
  MAINTENANCE_PERSONNEL_ENTER: 'maintenance.personnel.enter',
  // 经营管理 - 总览/分析
  OPERATION_HOME_READ: 'operation.home.read',
  OPERATION_ANALYSIS_READ: 'operation.analysis.read',
  // 合同业务
  OPERATION_CONTRACT_READ: 'operation.contract.read',
  OPERATION_CONTRACT_CREATE: 'operation.contract.create',
  OPERATION_CONTRACT_UPDATE: 'operation.contract.update',
  OPERATION_CONTRACT_VOID: 'operation.contract.void',
  OPERATION_CONTRACT_DELETE: 'operation.contract.delete',
  OPERATION_CONTRACT_BATCH_READ: 'operation.contract.batch_read',
  OPERATION_CONTRACT_BATCH_CREATE: 'operation.contract.batch_create',
  OPERATION_CONTRACT_BATCH_UPDATE: 'operation.contract.batch_update',
  OPERATION_CONTRACT_BATCH_DELETE: 'operation.contract.batch_delete',
  OPERATION_CONTRACT_RESTORE: 'operation.contract.restore',
  OPERATION_CONTRACT_ALLOCATE: 'operation.contract.allocate',
  OPERATION_CONTRACT_ALLOCATE_CANCEL: 'operation.contract.allocate_cancel',
  OPERATION_CONTRACT_RATE: 'operation.contract.rate',
  OPERATION_CONTRACT_EXPORT: 'operation.contract.export',
  // 订单业务
  OPERATION_ORDER_READ: 'operation.order.read',
  OPERATION_ORDER_UPLOAD: 'operation.order.upload',
  OPERATION_ORDER_BATCH_VOID: 'operation.order.batch_void',
  OPERATION_ORDER_BATCH_RESTORE: 'operation.order.batch_restore',
  OPERATION_ORDER_EXPORT: 'operation.order.export',
  // 线下完工
  OPERATION_COMPLETION_READ: 'operation.completion.read',
  OPERATION_COMPLETION_CREATE: 'operation.completion.create',
  OPERATION_COMPLETION_SUBMIT: 'operation.completion.submit',
  OPERATION_COMPLETION_APPROVE: 'operation.completion.approve',
  OPERATION_COMPLETION_REJECT: 'operation.completion.reject',
  OPERATION_COMPLETION_VOID: 'operation.completion.void',
  OPERATION_COMPLETION_EXPORT: 'operation.completion.export',
  // 成本
  OPERATION_COST_READ: 'operation.cost.read',
  OPERATION_COST_CREATE: 'operation.cost.create',
  OPERATION_COST_SUBMIT: 'operation.cost.submit',
  OPERATION_COST_APPROVE: 'operation.cost.approve',
  OPERATION_COST_REJECT: 'operation.cost.reject',
  OPERATION_COST_VOID: 'operation.cost.void',
  OPERATION_COST_EXPORT: 'operation.cost.export',
  // 系统管理
  OPERATION_USER_MANAGE: 'operation.user.manage',
  OPERATION_ROLE_MANAGE: 'operation.role.manage',
  OPERATION_MODULE_MANAGE: 'operation.module.manage',
  OPERATION_SETTINGS_READ: 'operation.settings.read',
  OPERATION_SETTINGS_MANAGE: 'operation.settings.manage',
  OPERATION_REGION_MANAGE: 'operation.region.manage',
  // 消息与公告
  OPERATION_MESSAGE_READ: 'operation.message.read',
  OPERATION_ANNOUNCEMENT_CREATE: 'operation.announcement.create',
  OPERATION_ANNOUNCEMENT_PUBLISH: 'operation.announcement.publish',
  OPERATION_ANNOUNCEMENT_MANAGE: 'operation.announcement.manage',
} as const;
export type BizPermissionCodeValue = (typeof BizPermissionCode)[keyof typeof BizPermissionCode];

/** 四类角色默认权限码（基线 02 TABLE 2-7；super_admin 由服务端通配 ALL，不在此表） */
export const ROLE_DEFAULT_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  admin: [
    BizPermissionCode.PORTAL_ENGINEERING_ENTER,
    BizPermissionCode.PORTAL_MAINTENANCE_ENTER,
    BizPermissionCode.MAINTENANCE_OPERATION_ENTER,
    BizPermissionCode.OPERATION_HOME_READ,
    BizPermissionCode.OPERATION_ANALYSIS_READ,
    BizPermissionCode.OPERATION_CONTRACT_READ,
    BizPermissionCode.OPERATION_CONTRACT_CREATE,
    BizPermissionCode.OPERATION_CONTRACT_UPDATE,
    BizPermissionCode.OPERATION_CONTRACT_VOID,
    BizPermissionCode.OPERATION_CONTRACT_DELETE,
    BizPermissionCode.OPERATION_CONTRACT_BATCH_READ,
    BizPermissionCode.OPERATION_CONTRACT_BATCH_CREATE,
    BizPermissionCode.OPERATION_CONTRACT_BATCH_UPDATE,
    BizPermissionCode.OPERATION_CONTRACT_BATCH_DELETE,
    BizPermissionCode.OPERATION_CONTRACT_RESTORE,
    BizPermissionCode.OPERATION_CONTRACT_ALLOCATE,
    BizPermissionCode.OPERATION_CONTRACT_RATE,
    BizPermissionCode.OPERATION_CONTRACT_EXPORT,
    BizPermissionCode.OPERATION_ORDER_READ,
    BizPermissionCode.OPERATION_ORDER_UPLOAD,
    BizPermissionCode.OPERATION_ORDER_BATCH_VOID,
    BizPermissionCode.OPERATION_ORDER_BATCH_RESTORE,
    BizPermissionCode.OPERATION_ORDER_EXPORT,
    BizPermissionCode.OPERATION_COMPLETION_READ,
    BizPermissionCode.OPERATION_COMPLETION_APPROVE,
    BizPermissionCode.OPERATION_COMPLETION_REJECT,
    BizPermissionCode.OPERATION_COMPLETION_VOID,
    BizPermissionCode.OPERATION_COMPLETION_EXPORT,
    BizPermissionCode.OPERATION_COST_READ,
    BizPermissionCode.OPERATION_COST_CREATE,
    BizPermissionCode.OPERATION_COST_SUBMIT,
    BizPermissionCode.OPERATION_COST_APPROVE,
    BizPermissionCode.OPERATION_COST_REJECT,
    BizPermissionCode.OPERATION_COST_VOID,
    BizPermissionCode.OPERATION_COST_EXPORT,
    BizPermissionCode.OPERATION_SETTINGS_READ,
    BizPermissionCode.OPERATION_MESSAGE_READ,
    BizPermissionCode.OPERATION_ANNOUNCEMENT_CREATE,
    BizPermissionCode.OPERATION_ANNOUNCEMENT_PUBLISH,
    BizPermissionCode.OPERATION_ANNOUNCEMENT_MANAGE,
  ],
  contract_manager: [
    BizPermissionCode.PORTAL_MAINTENANCE_ENTER,
    BizPermissionCode.MAINTENANCE_OPERATION_ENTER,
    BizPermissionCode.OPERATION_CONTRACT_READ,
    BizPermissionCode.OPERATION_CONTRACT_CREATE,
    BizPermissionCode.OPERATION_CONTRACT_UPDATE,
    BizPermissionCode.OPERATION_CONTRACT_VOID,
    BizPermissionCode.OPERATION_CONTRACT_DELETE,
    BizPermissionCode.OPERATION_CONTRACT_BATCH_READ,
    BizPermissionCode.OPERATION_CONTRACT_BATCH_CREATE,
    BizPermissionCode.OPERATION_CONTRACT_BATCH_UPDATE,
    BizPermissionCode.OPERATION_CONTRACT_BATCH_DELETE,
    BizPermissionCode.OPERATION_CONTRACT_RESTORE,
    BizPermissionCode.OPERATION_CONTRACT_ALLOCATE,
    BizPermissionCode.OPERATION_CONTRACT_ALLOCATE_CANCEL,
    BizPermissionCode.OPERATION_CONTRACT_RATE,
    BizPermissionCode.OPERATION_CONTRACT_EXPORT,
    BizPermissionCode.OPERATION_ORDER_READ,
    BizPermissionCode.OPERATION_ORDER_UPLOAD,
    BizPermissionCode.OPERATION_ORDER_BATCH_VOID,
    BizPermissionCode.OPERATION_ORDER_BATCH_RESTORE,
    BizPermissionCode.OPERATION_ORDER_EXPORT,
    BizPermissionCode.OPERATION_COST_READ,
    BizPermissionCode.OPERATION_COST_CREATE,
    BizPermissionCode.OPERATION_COST_SUBMIT,
    BizPermissionCode.OPERATION_COST_APPROVE,
    BizPermissionCode.OPERATION_COST_REJECT,
    BizPermissionCode.OPERATION_COST_VOID,
    BizPermissionCode.OPERATION_COST_EXPORT,
    BizPermissionCode.OPERATION_MESSAGE_READ,
  ],
  city_user: [
    BizPermissionCode.PORTAL_MAINTENANCE_ENTER,
    BizPermissionCode.MAINTENANCE_OPERATION_ENTER,
    BizPermissionCode.OPERATION_HOME_READ,
    BizPermissionCode.OPERATION_ANALYSIS_READ,
    BizPermissionCode.OPERATION_CONTRACT_READ,
    BizPermissionCode.OPERATION_CONTRACT_EXPORT,
    BizPermissionCode.OPERATION_ORDER_READ,
    BizPermissionCode.OPERATION_ORDER_EXPORT,
    BizPermissionCode.OPERATION_COMPLETION_READ,
    BizPermissionCode.OPERATION_COMPLETION_CREATE,
    BizPermissionCode.OPERATION_COMPLETION_SUBMIT,
    BizPermissionCode.OPERATION_COMPLETION_EXPORT,
    BizPermissionCode.OPERATION_COST_READ,
    BizPermissionCode.OPERATION_COST_CREATE,
    BizPermissionCode.OPERATION_COST_SUBMIT,
    BizPermissionCode.OPERATION_COST_EXPORT,
    BizPermissionCode.OPERATION_MESSAGE_READ,
  ],
};

/** 敏感订单数据权限开关（基线 01 §10.3：有权限导出完整值，其他脱敏） */
export const SENSITIVE_ORDER_PERMISSION = 'operation.order.sensitive_full';
