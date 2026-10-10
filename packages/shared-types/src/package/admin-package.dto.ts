/**
 * Admin 端报表包管理 DTO
 *
 * AdminPackageItem — GET /api/admin/packages 响应列表项
 * 包含月度上下文信息（当月状态、累计进度），便于管理员概览
 */
import type { PackageStatus } from '../enums';

/** Admin 端报表包列表项 */
export interface AdminPackageItem {
  /** 报表包 ID */
  id: number;
  /** 城市 ID */
  cityId: number;
  /** 城市名称（联表查询） */
  cityName: string;
  /** 报表年度 */
  reportYear: number;
  /** 包状态: draft | submitted */
  status: PackageStatus;
  /** 当月是否已提交（有快照） */
  currentMonthSubmitted: boolean;
  /** 本年累计已提交月数 */
  submittedMonthCount: number;
  /** 最后操作人 ID */
  lastUpdatedBy: number | null;
  /** 最后操作时间 */
  lastUpdatedAt: string | null;
  /** 创建时间 */
  createdAt: string;
  /** 更新时间 */
  updatedAt: string;
}
