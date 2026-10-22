/**
 * biz 导航单一数据源
 *
 * 为什么要有这个文件：侧栏菜单原先写死在 BizLayout 里，工作台页要再列一遍「权限内的入口」，
 * 两处各写一份的结果是迟早不一致——加了一个页面只在侧栏出现，或者工作台显示了一个点进去 403 的入口。
 * 现在入口定义只在这里维护，侧栏与工作台都从这里过滤，权限判定也只有一个函数。
 *
 * 结构：模块（module）→ 分组（group）→ 叶子（leaf）
 *   · 侧栏按 group 组装（经营管理下分经营/合同/成本/完工四个分组）
 *   · 工作台按 module 出卡片，卡片内按 group 分小节
 * 两边的叶子集合完全相同，只是排布方式不同。
 */
import { BizPermissionCode } from '@/utils/biz-permission-code';
import type { ReactNode } from 'react';
import {
  ApartmentOutlined, BarChartOutlined, BellOutlined, ClockCircleOutlined, DeleteOutlined, FileTextOutlined,
  InboxOutlined, RobotOutlined, SettingOutlined, SafetyCertificateOutlined, TeamOutlined, WalletOutlined,
} from '@ant-design/icons';

export const ROLE_LABEL: Record<string, string> = {
  super_admin: '超级管理员',
  admin: '省级运营管理员',
  contract_manager: '合同管理员',
  city_user: '地市用户',
};

export type NavModuleCode = 'maintenance' | 'engineering' | 'operation' | 'message' | 'system' | 'assistant';

export type NavGroupCode =
  | 'maintenance-core' | 'maintenance-assets' | 'performance'
  | 'assessment'
  | 'analysis' | 'contract' | 'cost' | 'completion'
  | 'message'
  | 'assistant'
  | 'system';

export interface NavModuleDef {
  code: NavModuleCode;
  label: string;
  icon: ReactNode;
}

export interface NavGroupDef {
  code: NavGroupCode;
  label: string;
  icon: ReactNode;
  module: NavModuleCode;
  /** 工作台上的小节名；不填则用 label。用于避免「经营管理 → 经营管理」这种重复标题 */
  workbenchLabel?: string;
}

export interface NavLeaf {
  /** 路由地址，也是菜单 key */
  key: string;
  label: string;
  icon?: ReactNode;
  /** 单个权限码表示「必须有」；数组表示「任一满足」 */
  permission?: string | string[];
  /** 这些角色无论权限如何都不显示（合同上传/管理费率对地市恒隐藏） */
  hideForRoles?: string[];
  /** 与权限码无关，仅超管可见 */
  superOnly?: boolean;
  group: NavGroupCode;
}

export const NAV_MODULES: NavModuleDef[] = [
  { code: 'maintenance', label: '维护管理', icon: <ApartmentOutlined /> },
  { code: 'engineering', label: '工程管理', icon: <SafetyCertificateOutlined /> },
  { code: 'operation', label: '经营管理', icon: <BarChartOutlined /> },
  { code: 'message', label: '消息中心', icon: <BellOutlined /> },
  { code: 'assistant', label: '智能助手', icon: <RobotOutlined /> },
  { code: 'system', label: '系统设置', icon: <SettingOutlined /> },
];

export const NAV_GROUPS: NavGroupDef[] = [
  { code: 'maintenance-core', label: '维护总览', icon: <BarChartOutlined />, module: 'maintenance' },
  { code: 'maintenance-assets', label: '资产管理', icon: <InboxOutlined />, module: 'maintenance' },
  { code: 'performance', label: '月度考核', icon: <BarChartOutlined />, module: 'maintenance' },
  { code: 'assessment', label: '后评估管理', icon: <SafetyCertificateOutlined />, module: 'engineering' },
  { code: 'analysis', label: '经营管理', icon: <BarChartOutlined />, module: 'operation', workbenchLabel: '经营分析' },
  { code: 'contract', label: '合同管理', icon: <FileTextOutlined />, module: 'operation' },
  { code: 'cost', label: '成本管理', icon: <WalletOutlined />, module: 'operation' },
  { code: 'completion', label: '完工管理', icon: <TeamOutlined />, module: 'operation' },
  { code: 'message', label: '消息中心', icon: <BellOutlined />, module: 'message' },
  { code: 'assistant', label: '智能助手', icon: <RobotOutlined />, module: 'assistant' },
  { code: 'system', label: '系统设置', icon: <SettingOutlined />, module: 'system' },
];

/**
 * 总览与到期台账横跨三类资产，后端用「人员进入 或 资产进入」任一放行，
 * 菜单必须同口径，否则 contract_manager 会看到一个点进去就 403 的入口。
 */
const MAINTENANCE_LEDGER_PERMISSIONS = [BizPermissionCode.MAINTENANCE_PERSONNEL_ENTER, BizPermissionCode.MAINTENANCE_ASSET_ENTER];

export const NAV_LEAVES: NavLeaf[] = [
  // ---------- 维护管理 ----------
  { key: '/biz/maintenance/overview', label: '数据总览', icon: <BarChartOutlined />, permission: MAINTENANCE_LEDGER_PERMISSIONS, group: 'maintenance-core' },
  { key: '/biz/maintenance/expiry', label: '到期台账', icon: <ClockCircleOutlined />, permission: MAINTENANCE_LEDGER_PERMISSIONS, group: 'maintenance-core' },
  { key: '/biz/maintenance/personnel', label: '人员管理', icon: <TeamOutlined />, permission: BizPermissionCode.MAINTENANCE_PERSONNEL_ENTER, group: 'maintenance-core' },
  { key: '/biz/maintenance/vehicles', label: '车辆管理', icon: <InboxOutlined />, permission: BizPermissionCode.MAINTENANCE_ASSET_ENTER, group: 'maintenance-assets' },
  { key: '/biz/maintenance/generators', label: '油机管理', icon: <SettingOutlined />, permission: BizPermissionCode.MAINTENANCE_ASSET_ENTER, group: 'maintenance-assets' },
  { key: '/biz/performance/monthly-score', label: '月度分数', permission: BizPermissionCode.PERFORMANCE_OVERVIEW_READ, group: 'performance' },
  { key: '/biz/performance/overview', label: '绩效总览', permission: BizPermissionCode.PERFORMANCE_OVERVIEW_READ, group: 'performance' },
  { key: '/biz/performance/upload', label: '绩效上传', permission: BizPermissionCode.PERFORMANCE_UPLOAD_READ, group: 'performance' },

  // ---------- 工程管理 ----------
  { key: '/biz/engineering/assessment', label: '后评估概览', permission: BizPermissionCode.ASSESSMENT_OVERVIEW_READ, group: 'assessment' },
  { key: '/biz/engineering/assessment/detail', label: '明细', permission: BizPermissionCode.ASSESSMENT_OVERVIEW_READ, group: 'assessment' },
  { key: '/biz/engineering/assessment/import', label: '数据导入', permission: 'assessment.import.read', group: 'assessment' },
  { key: '/biz/engineering/assessment/entry', label: '线下填报', permission: BizPermissionCode.ASSESSMENT_ENTRY_READ, group: 'assessment' },

  // ---------- 经营管理 ----------
  { key: '/biz/analysis', label: '经营概览', icon: <BarChartOutlined />, permission: BizPermissionCode.OPERATION_ANALYSIS_READ, group: 'analysis' },
  { key: '/biz/analysis/trend', label: '月度趋势', icon: <BarChartOutlined />, permission: BizPermissionCode.OPERATION_ANALYSIS_READ, group: 'analysis' },
  // 地市对比/超额清单的页面语义是「多地市横向比较」，而地市账号的数据范围只有本地市，
  // 收敛后页面永远只有一行数据，用户会以为系统出错。这里直接不对地市账号展示这两个入口
  // （经营概览/月度趋势已能看本地市的数与趋势）。
  { key: '/biz/analysis/cities', label: '地市对比', icon: <ApartmentOutlined />, permission: BizPermissionCode.OPERATION_ANALYSIS_READ, hideForRoles: ['city_user'], group: 'analysis' },
  { key: '/biz/analysis/overruns', label: '超额清单', icon: <WalletOutlined />, permission: BizPermissionCode.OPERATION_ANALYSIS_READ, hideForRoles: ['city_user'], group: 'analysis' },
  { key: '/biz/contract-overview', label: '合同概览', icon: <FileTextOutlined />, permission: BizPermissionCode.OPERATION_CONTRACT_READ, group: 'contract' },
  { key: '/biz/operation', label: '合同上传', icon: <FileTextOutlined />, permission: BizPermissionCode.OPERATION_CONTRACT_READ, hideForRoles: ['city_user'], group: 'contract' },
  { key: '/biz/fee-rates', label: '管理费率', icon: <WalletOutlined />, permission: BizPermissionCode.OPERATION_CONTRACT_READ, hideForRoles: ['city_user'], group: 'contract' },
  { key: '/biz/costs', label: '地市成本', icon: <WalletOutlined />, permission: BizPermissionCode.OPERATION_COST_READ, group: 'cost' },
  { key: '/biz/orders', label: '订单管理', icon: <InboxOutlined />, permission: BizPermissionCode.OPERATION_ORDER_UPLOAD, group: 'completion' },
  { key: '/biz/offline-completions', label: '线下完工', icon: <TeamOutlined />, permission: BizPermissionCode.OPERATION_COMPLETION_READ, group: 'completion' },

  // ---------- 消息 ----------
  { key: '/biz/messages', label: '消息中心', icon: <BellOutlined />, permission: BizPermissionCode.OPERATION_MESSAGE_READ, group: 'message' },

  // ---------- 智能助手 ----------
  // 不设 permission：登录即可进入。能查到什么由后端按「意图权限 + 数据范围」决定，
  // 前端若再按门户权限拦一道，会出现「有后评估权限但没门户权限」的账号看不到入口的怪事。
  { key: '/biz/ai', label: '智能问答', icon: <RobotOutlined />, group: 'assistant' },

  // ---------- 系统设置 ----------
  { key: '/biz/settings', label: '系统设置', icon: <SettingOutlined />, permission: BizPermissionCode.OPERATION_SETTINGS_READ, group: 'system' },
  { key: '/biz/admin', label: '权限管理', icon: <ApartmentOutlined />, permission: BizPermissionCode.OPERATION_USER_MANAGE, group: 'system' },
  { key: '/biz/region-settings', label: '省市设置', icon: <ApartmentOutlined />, permission: BizPermissionCode.OPERATION_REGION_MANAGE, group: 'system' },
  { key: '/biz/audit-logs', label: '审计日志', icon: <FileTextOutlined />, permission: BizPermissionCode.OPERATION_USER_MANAGE, group: 'system' },
  { key: '/biz/data-delete', label: '数据删除', icon: <DeleteOutlined />, superOnly: true, group: 'system' },
];

/**
 * 单个入口是否可见。
 * super_admin 对权限码通配，但 superOnly 与 hideForRoles 仍然生效——
 * 「数据删除」这类入口是身份限制，不是权限点能授予的。
 */
export function canSeeLeaf(leaf: NavLeaf, permissions: Set<string>, isSuper: boolean, roleCode?: string): boolean {
  if (leaf.superOnly && !isSuper) return false;
  if (leaf.hideForRoles?.length && roleCode && leaf.hideForRoles.includes(roleCode)) return false;
  if (!leaf.permission) return true;
  if (isSuper) return true;
  const codes = Array.isArray(leaf.permission) ? leaf.permission : [leaf.permission];
  return codes.some((code) => permissions.has(code));
}

/** 当前账号可见的全部叶子入口（保持 NAV_LEAVES 里的声明顺序，侧栏与工作台都依赖这个顺序） */
export function visibleLeaves(permissions: Set<string>, isSuper: boolean, roleCode?: string): NavLeaf[] {
  return NAV_LEAVES.filter((leaf) => canSeeLeaf(leaf, permissions, isSuper, roleCode));
}

/** 某个模块下可见的叶子 */
export function leavesOfModule(module: NavModuleCode, permissions: Set<string>, isSuper: boolean, roleCode?: string): NavLeaf[] {
  const groups = new Set(NAV_GROUPS.filter((group) => group.module === module).map((group) => group.code));
  return visibleLeaves(permissions, isSuper, roleCode).filter((leaf) => groups.has(leaf.group));
}

/**
 * 路由 → 应展开的分组。
 * 只有存在父子分组的路由才需要（车辆/油机属于「资产管理」，总览/台账/人员是顶层叶子）。
 */
export function groupOfPath(pathname: string): NavGroupCode | undefined {
  // 叶子路由必须优先于父路由匹配，否则 /biz/analysis/trend 会被 /biz/analysis 吃掉
  const sorted = [...NAV_LEAVES].sort((a, b) => b.key.length - a.key.length);
  return sorted.find((leaf) => pathname === leaf.key || pathname.startsWith(`${leaf.key}/`))?.group;
}

/**
 * 分组 → 侧栏里父菜单的 key。
 * 顶层叶子（总览/台账/人员/消息/系统）没有父级，返回 undefined，侧栏就不会去展开无关分组。
 * 原先对 /biz/maintenance 一刀切展开「资产管理」，点「到期台账」会顺带弹开无关分组。
 */
const GROUP_PARENT_KEY: Record<NavGroupCode, string | undefined> = {
  'maintenance-core': undefined,
  'maintenance-assets': 'maintenance-assets',
  performance: 'performance',
  assessment: 'assessment',
  analysis: 'biz-analysis',
  contract: 'biz-contract',
  cost: 'biz-cost',
  completion: 'biz-completion',
  message: undefined,
  assistant: undefined,
  system: undefined,
};

export function parentMenuKeyOfPath(pathname: string): string | undefined {
  const group = groupOfPath(pathname);
  return group ? GROUP_PARENT_KEY[group] : undefined;
}

/** 叶子路由清单（按长度倒序），给侧栏 selectedKeys 用 */
export const NAV_PATHS: string[] = [...NAV_LEAVES]
  .map((leaf) => leaf.key)
  .sort((a, b) => b.length - a.length);

export function moduleOfPath(pathname: string): NavModuleCode | undefined {
  const group = groupOfPath(pathname);
  return group ? NAV_GROUPS.find((item) => item.code === group)?.module : undefined;
}
