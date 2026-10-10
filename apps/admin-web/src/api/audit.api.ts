import type { OperationLogListRequest, OperationLogListResponse } from '@biz-reporting/shared-types';
import request from '@/utils/request';

export const auditApi = {
  list: (query: OperationLogListRequest) => request.get('/admin/operation-logs', { params: query }) as Promise<OperationLogListResponse>,
};
