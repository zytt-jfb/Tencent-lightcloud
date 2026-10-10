/**
 * 年度报表包实体
 * 来源：DDL annual_report_packages 表
 *
 * 核心概念：
 * - 每个 city_id × report_year 有且仅有一个 package（UNIQUE 约束）
 * - status 在 draft ↔ submitted 之间流转
 * - last_updated_by 记录最后操作人
 */
export interface AnnualReportPackage {
  id: number;
  cityId: number;
  reportYear: number;
  status: import('../enums').PackageStatus;
  lastUpdatedBy: number | null;
  lastUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}
