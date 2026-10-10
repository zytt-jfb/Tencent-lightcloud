import { PaginationParams } from './base';

/**
 * 操作日志列表筛选参数
 */
export interface OperationLogFilter {
  actionType?: string;
  targetType?: string;
  operatorUserId?: number;
  cityId?: number;
  dateFrom?: string; // ISO 8601 date string
  dateTo?: string;   // ISO 8601 date string
}

/**
 * 操作日志列表请求参数
 */
export interface OperationLogListRequest extends PaginationParams {
  actionType?: string;
  targetType?: string;
  operatorUserId?: number;
  cityId?: number;
  dateFrom?: string;
  dateTo?: string;
}

/**
 * 操作日志列表响应
 */
export interface OperationLogListResponse {
  items: Array<{
    id: number;
    operatorUserId: number;
    operatorCityId: number | null;
    actionType: string;
    targetType: string;
    targetId: string;
    summaryText: string;
    resultStatus: string;
    createdAt: Date;
    operatorName: string | null;
    operatorCityName: string | null;
  }>;
  total: number;
  page: number;
  pageSize: number;
}