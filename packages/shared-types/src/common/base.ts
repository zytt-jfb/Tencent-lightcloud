/**
 * 通用基础类型
 */
export interface BaseEntity {
  id: number;
  createdAt: Date;
  updatedAt: Date;
}

/** 分页请求参数 */
export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

/** 分页响应包装 */
export interface PaginatedResponse<T> {
  items: T[];
  total?: number;
  page?: number;
  pageSize?: number;
}

/** API 统一成功响应 */
export interface ApiResponse<T = void> {
  code: number; // 默认 0 表示成功
  data: T;
  message?: string;
}

/** API 错误响应 */
export interface ApiErrorResponse {
  code: number; // 非 0 表示错误
  message: string;
  details?: string;
}
