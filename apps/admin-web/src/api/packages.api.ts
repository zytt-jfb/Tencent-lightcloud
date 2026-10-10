/**
 * 报表包管理 API（Admin 端）
 */
import type {
  AdminPackageItem,
  PaginatedResponse,
  ReturnToDraftRequest,
  UnlockMonthsRequest,
  BulkUnlockMonthsRequest,
  BulkUnlockMonthsResponse,
  OpenCurrentMonthContractRequest,
} from '@biz-reporting/shared-types';
import request from '@/utils/request';

const BASE = '/admin/packages';

/** 获取报表包列表（GET /api/admin/packages） */
export function listPackages(): Promise<PaginatedResponse<AdminPackageItem>> {
  return request.get(BASE);
}

/** 退回报表包到草稿（POST /admin/packages/{id}/return-to-draft） */
export function returnToDraft(
  packageId: number,
  data: ReturnToDraftRequest,
): Promise<void> {
  return request.post(`${BASE}/${packageId}/return-to-draft`, data);
}

/** 解锁单个报表包的历史月份（POST /admin/packages/{id}/unlock-months） */
export function unlockMonths(
  packageId: number,
  data: UnlockMonthsRequest,
): Promise<void> {
  return request.post(`${BASE}/${packageId}/unlock-months`, data);
}

/** 批量解锁全部地市指定月份（POST /admin/packages/bulk-unlock-months） */
export function bulkUnlockMonths(
  data: BulkUnlockMonthsRequest,
): Promise<BulkUnlockMonthsResponse> {
  return request.post(`${BASE}/bulk-unlock-months`, data);
}

/** 开放指定月份新增合同填报权限（POST /admin/packages/{id}/open-current-month-contract） */
export function openCurrentMonthContract(
  packageId: number,
  data: OpenCurrentMonthContractRequest,
): Promise<void> {
  return request.post(`${BASE}/${packageId}/open-current-month-contract`, data);
}
