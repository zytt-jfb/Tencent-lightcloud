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
  /** 工程管理下的二级模块：后评估管理 */
  ASSESSMENT: 'assessment',
} as const;
export type BizModuleCodeValue = (typeof BizModuleCode)[keyof typeof BizModuleCode];

// ============================================================
// 经营管理权限码（operation.*）
// ============================================================
export const BizPermissionCode = {
  // 一级门户
  PORTAL_ENGINEERING_ENTER: 'portal.engineering.enter',
  PORTAL_MAINTENANCE_ENTER: 'portal.maintenance.enter',
  /** 系统设置一级门户（前端 BizLayout 模块守卫与 BizAdmin 分组都在用，补进常量表） */
  PORTAL_SYSTEM_ENTER: 'portal.system.enter',
  // 维护管理二级门户
  MAINTENANCE_OPERATION_ENTER: 'maintenance.operation.enter',
  MAINTENANCE_ASSET_ENTER: 'maintenance.asset.enter',
  MAINTENANCE_PERSONNEL_ENTER: 'maintenance.personnel.enter',
  MAINTENANCE_DATA_DELETE: 'maintenance.data.delete',
  /** 新增 / 编辑维护数据。只回答「能不能写」，能写哪个地市由账号数据范围二次约束 */
  MAINTENANCE_DATA_WRITE: 'maintenance.data.write',
  /** 身份证 / 手机号等敏感字段的明文查看（未授予者读到掩码） */
  MAINTENANCE_SENSITIVE_READ: 'maintenance.sensitive.read',
  // 维护管理 - 月度考核（与后评估是两套数据、两套算法，权限点也分开）
  PERFORMANCE_OVERVIEW_READ: 'performance.overview.read',
  PERFORMANCE_OVERVIEW_EXPORT: 'performance.overview.export',
  PERFORMANCE_UPLOAD_READ: 'performance.upload.read',
  PERFORMANCE_UPLOAD_CREATE: 'performance.upload.create',
  // 工程管理 - 后评估管理
  ASSESSMENT_OVERVIEW_READ: 'assessment.overview.read',
  ASSESSMENT_OVERVIEW_EXPORT: 'assessment.overview.export',
  ASSESSMENT_IMPORT_READ: 'assessment.import.read',
  ASSESSMENT_IMPORT_UPLOAD: 'assessment.import.upload',
  ASSESSMENT_IMPORT_DELETE: 'assessment.import.delete',
  ASSESSMENT_ENTRY_READ: 'assessment.entry.read',
  ASSESSMENT_ENTRY_CREATE: 'assessment.entry.create',
  ASSESSMENT_ENTRY_SUBMIT: 'assessment.entry.submit',
  ASSESSMENT_ENTRY_RETURN: 'assessment.entry.return',
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
  /**
   * 数据删除台账（超级管理员的数据删除页）。
   * 原先 /api/biz/admin/data/* 只靠 biz-auth.guard 的「路径前缀 → portal.system.enter」兜底，
   * 端点本身没有任何权限声明；补这两个码把保护从「猜路径」变成「显式声明」。
   */
  SYSTEM_DATA_READ: 'system.data.read',
  SYSTEM_DATA_DELETE: 'system.data.delete',
  // 消息与公告
  OPERATION_MESSAGE_READ: 'operation.message.read',
  OPERATION_ANNOUNCEMENT_CREATE: 'operation.announcement.create',
  OPERATION_ANNOUNCEMENT_PUBLISH: 'operation.announcement.publish',
  OPERATION_ANNOUNCEMENT_MANAGE: 'operation.announcement.manage',
  /**
   * 智能助手批量导入（人员 / 车辆 / 油机 / 各模块台账）。
   *
   * 为什么单独一个码、且默认不授予任何角色：
   *   批量导入一次能写入成百上千行，破坏力远大于单条新增；如果只按模块写权限放行，
   *   任何能编辑一条记录的人都能在 AI 入口批量覆盖整张表。所以把「能不能用批量导入」
   *   独立成一个开关，由 admin 逐个账号授权。
   *   判定是双闸：本码 AND 目标模块的写权限（见 MaintenanceBatchImportService）。
   */
  ASSISTANT_IMPORT_EXECUTE: 'assistant.import.execute',
} as const;
export type BizPermissionCodeValue = (typeof BizPermissionCode)[keyof typeof BizPermissionCode];

/**
 * 四类角色默认权限码（基线 02 TABLE 2-7；super_admin 由服务端通配 ALL，不在此表）
 * 注意：此常量当前**不参与运行时**，真正生效的是 apps/api/migration 下的 SQL 种子
 * （012 基础 + 019 admin/contract_manager 补充 + 021 合同 + 045 绩效 + 046 维护写入）。
 * 改权限时两边都要改，否则这份文档会骗人。历次教训：
 *  - contract_manager 曾经在这里（以及 019）挂了一整组 operation.cost.*，
 *    但它的数据范围是 contract，而成本/完工/经营分析对 contract scope 一律 403，
 *    结果就是「入口看得见、点进去必 403」的死入口。已由 019 修订 + 047 回收修复。
 *  - city_user 曾经漏了 performance.overview.read/export，与 045 不一致。
 */
export const ROLE_DEFAULT_PERMISSIONS: Readonly<Record<string, readonly string[]>> = {
  admin: [
    BizPermissionCode.PORTAL_ENGINEERING_ENTER,
    BizPermissionCode.PORTAL_MAINTENANCE_ENTER,
    BizPermissionCode.MAINTENANCE_OPERATION_ENTER,
    BizPermissionCode.MAINTENANCE_PERSONNEL_ENTER,
    BizPermissionCode.MAINTENANCE_ASSET_ENTER,
    BizPermissionCode.MAINTENANCE_DATA_WRITE,
    BizPermissionCode.MAINTENANCE_SENSITIVE_READ,
    BizPermissionCode.PERFORMANCE_OVERVIEW_READ,
    BizPermissionCode.PERFORMANCE_OVERVIEW_EXPORT,
    BizPermissionCode.ASSESSMENT_OVERVIEW_READ,
    BizPermissionCode.ASSESSMENT_OVERVIEW_EXPORT,
    BizPermissionCode.ASSESSMENT_IMPORT_READ,
    BizPermissionCode.ASSESSMENT_IMPORT_UPLOAD,
    BizPermissionCode.ASSESSMENT_IMPORT_DELETE,
    BizPermissionCode.ASSESSMENT_ENTRY_READ,
    BizPermissionCode.ASSESSMENT_ENTRY_CREATE,
    BizPermissionCode.ASSESSMENT_ENTRY_SUBMIT,
    BizPermissionCode.ASSESSMENT_ENTRY_RETURN,
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
    BizPermissionCode.OPERATION_MESSAGE_READ,
  ],
  city_user: [
    BizPermissionCode.PORTAL_MAINTENANCE_ENTER,
    BizPermissionCode.PORTAL_ENGINEERING_ENTER,
    BizPermissionCode.MAINTENANCE_OPERATION_ENTER,
    BizPermissionCode.MAINTENANCE_PERSONNEL_ENTER,
    BizPermissionCode.MAINTENANCE_ASSET_ENTER,
    BizPermissionCode.MAINTENANCE_DATA_WRITE,
    BizPermissionCode.PERFORMANCE_OVERVIEW_READ,
    BizPermissionCode.PERFORMANCE_OVERVIEW_EXPORT,
    BizPermissionCode.ASSESSMENT_OVERVIEW_READ,
    BizPermissionCode.ASSESSMENT_OVERVIEW_EXPORT,
    BizPermissionCode.ASSESSMENT_ENTRY_READ,
    BizPermissionCode.ASSESSMENT_ENTRY_CREATE,
    BizPermissionCode.ASSESSMENT_ENTRY_SUBMIT,
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

// ============================================================
// 门户域（portal domain）—— 模块入口判定的唯一维度
// ============================================================

/**
 * 为什么需要「域」这一层，而不是直接用权限码前缀切模块：
 *   现有码里 `operation.*` 横跨两个模块 —— operation.contract.read 属于经营管理，
 *   operation.user.manage 属于系统设置；`maintenance.operation.enter` 名字带 maintenance，
 *   语义却是「经营管理模块入口」。按字符串前缀推导一定判错。
 *   所以把归属写死成一张显式表，前后端共用同一份，谁也不再各写一套。
 *
 * 与 `portal.*.enter` 的关系：
 *   那四个入口码是历史产物（「有这个模块里任意一个能力」的重复表达）。
 *   本表暂时把它们也收进来，是为了让改造期「现在能进的，改后仍然能进」；
 *   等权限码统一改名时这四个码会消失，届时删掉对应行即可，判定逻辑不用动。
 */
export const PortalDomain = {
  ENGINEERING: 'engineering',
  MAINTENANCE: 'maintenance',
  OPERATION: 'operation',
  SYSTEM: 'system',
  /** 智能助手不设入口门槛：登录即可进，能查什么由后端按意图权限与数据范围决定 */
  ASSISTANT: 'assistant',
} as const;
export type PortalDomainValue = (typeof PortalDomain)[keyof typeof PortalDomain];

/** 每个域下有哪些权限码（一个码只能属于一个域，启动时由 assertDomainCatalogIntegrity 校验） */
export const DOMAIN_PERMISSIONS: Readonly<Record<PortalDomainValue, readonly string[]>> = {
  engineering: [
    BizPermissionCode.PORTAL_ENGINEERING_ENTER,
    BizPermissionCode.ASSESSMENT_OVERVIEW_READ,
    BizPermissionCode.ASSESSMENT_OVERVIEW_EXPORT,
    BizPermissionCode.ASSESSMENT_IMPORT_READ,
    BizPermissionCode.ASSESSMENT_IMPORT_UPLOAD,
    BizPermissionCode.ASSESSMENT_IMPORT_DELETE,
    BizPermissionCode.ASSESSMENT_ENTRY_READ,
    BizPermissionCode.ASSESSMENT_ENTRY_CREATE,
    BizPermissionCode.ASSESSMENT_ENTRY_SUBMIT,
    BizPermissionCode.ASSESSMENT_ENTRY_RETURN,
  ],
  maintenance: [
    BizPermissionCode.PORTAL_MAINTENANCE_ENTER,
    BizPermissionCode.MAINTENANCE_OPERATION_ENTER,
    BizPermissionCode.MAINTENANCE_ASSET_ENTER,
    BizPermissionCode.MAINTENANCE_PERSONNEL_ENTER,
    BizPermissionCode.MAINTENANCE_DATA_DELETE,
    BizPermissionCode.MAINTENANCE_DATA_WRITE,
    BizPermissionCode.MAINTENANCE_SENSITIVE_READ,
    BizPermissionCode.PERFORMANCE_OVERVIEW_READ,
    BizPermissionCode.PERFORMANCE_OVERVIEW_EXPORT,
    BizPermissionCode.PERFORMANCE_UPLOAD_READ,
    BizPermissionCode.PERFORMANCE_UPLOAD_CREATE,
  ],
  operation: [
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
    BizPermissionCode.OPERATION_CONTRACT_ALLOCATE_CANCEL,
    BizPermissionCode.OPERATION_CONTRACT_RATE,
    BizPermissionCode.OPERATION_CONTRACT_EXPORT,
    BizPermissionCode.OPERATION_ORDER_READ,
    BizPermissionCode.OPERATION_ORDER_UPLOAD,
    BizPermissionCode.OPERATION_ORDER_BATCH_VOID,
    BizPermissionCode.OPERATION_ORDER_BATCH_RESTORE,
    BizPermissionCode.OPERATION_ORDER_EXPORT,
    BizPermissionCode.OPERATION_COMPLETION_READ,
    BizPermissionCode.OPERATION_COMPLETION_CREATE,
    BizPermissionCode.OPERATION_COMPLETION_SUBMIT,
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
    SENSITIVE_ORDER_PERMISSION,
    /**
     * 消息中心刻意归「经营管理」，不归「系统设置」。
     * 消息是全员功能（contract_manager 也有），而「系统设置」是管理岗才该进的模块；
     * 若把 message.read 放进 system 域，任何能看消息的账号都会拿到系统设置入口。
     * 前端 /biz/messages 本身不设模块门槛，这里的归属只影响域聚合，不会让消息页变难进。
     */
    BizPermissionCode.OPERATION_MESSAGE_READ,
  ],
  system: [
    BizPermissionCode.PORTAL_SYSTEM_ENTER,
    BizPermissionCode.OPERATION_USER_MANAGE,
    BizPermissionCode.OPERATION_ROLE_MANAGE,
    BizPermissionCode.OPERATION_MODULE_MANAGE,
    BizPermissionCode.OPERATION_SETTINGS_READ,
    BizPermissionCode.OPERATION_SETTINGS_MANAGE,
    BizPermissionCode.OPERATION_REGION_MANAGE,
    BizPermissionCode.OPERATION_ANNOUNCEMENT_CREATE,
    BizPermissionCode.OPERATION_ANNOUNCEMENT_PUBLISH,
    BizPermissionCode.OPERATION_ANNOUNCEMENT_MANAGE,
    BizPermissionCode.SYSTEM_DATA_READ,
    BizPermissionCode.SYSTEM_DATA_DELETE,
  ],
  assistant: [BizPermissionCode.ASSISTANT_IMPORT_EXECUTE],
};

const DOMAIN_OF_PERMISSION: ReadonlyMap<string, PortalDomainValue> = new Map(
  (Object.entries(DOMAIN_PERMISSIONS) as Array<[PortalDomainValue, readonly string[]]>)
    .flatMap(([domain, codes]) => codes.map((code) => [code, domain] as const)),
);

/** 单个权限码属于哪个域；未登记的码返回 null（启动自检会把它当问题报出来） */
export function domainOfPermission(code: string): PortalDomainValue | null {
  return DOMAIN_OF_PERMISSION.get(code) ?? null;
}

/** 把一组权限码聚合成域集合：后端 BizAuthContext.modulePermissions 就是它的产物 */
export function domainsOfPermissions(codes: Iterable<string>): Set<PortalDomainValue> {
  const domains = new Set<PortalDomainValue>();
  for (const code of codes) {
    const domain = DOMAIN_OF_PERMISSION.get(code);
    if (domain) domains.add(domain);
  }
  return domains;
}

/**
 * 目录自检：同一个权限码不允许出现在两个域里。
 * 返回冲突描述数组，空数组表示健康。服务启动时调用一次，把配置错误暴露在日志里。
 */
export function assertDomainCatalogIntegrity(): string[] {
  const seen = new Map<string, PortalDomainValue>();
  const problems: string[] = [];
  for (const [domain, codes] of Object.entries(DOMAIN_PERMISSIONS) as Array<[PortalDomainValue, readonly string[]]>) {
    for (const code of codes) {
      const previous = seen.get(code);
      if (previous && previous !== domain) problems.push(`${code}: ${previous} 与 ${domain} 重复登记`);
      else seen.set(code, domain);
    }
  }
  return problems;
}
