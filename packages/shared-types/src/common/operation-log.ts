/**
 * 操作日志
 * 来源：DDL operation_logs 表
 *
 * 记录所有管理操作（状态变更、数据修改等）
 * - before_data_json / after_data_json 记录变更前后完整快照
 */
export interface OperationLog {
  id: number;
  operatorUserId: number;
  operatorCityId: number | null;
  actionType: string;
  targetType: string;
  targetId: string;
  summaryText: string;
  beforeDataJson: Record<string, unknown> | null;
  afterDataJson: Record<string, unknown> | null;
  resultStatus: string;
  createdAt: Date;
}
