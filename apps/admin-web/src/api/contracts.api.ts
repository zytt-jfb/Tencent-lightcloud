/**
 * 合同 API
 * 对应冻结 OpenAPI 端点：
 *   GET    /api/admin/contracts             — 分页列表
 *   GET    /api/admin/contracts/:id          — 详情（含 allocations）
 *   POST   /api/admin/contracts              — 创建
 *   PATCH  /api/admin/contracts/:id          — 更新
 *   DELETE /api/admin/contracts/:id          — 软删除
 *   POST   /api/admin/contracts/:id/allocations — 新增分配
 *   PATCH  /api/admin/allocations/:id        — 更新分配
 *   DELETE /api/admin/allocations/:id        — 删除分配
 */
import type {
  Contract,
  ContractCityAllocation,
  CreateContractRequest,
  UpdateContractRequest,
  CreateAllocationRequest,
  UpdateAllocationRequest,
  PaginatedResponse,
  PaginationParams,
} from '@biz-reporting/shared-types';
import request from '@/utils/request';

const BASE = '/admin/contracts';

/** 分页获取合同列表 */
export function listContracts(
  params?: PaginationParams,
): Promise<PaginatedResponse<Contract>> {
  return request.get(BASE, { params });
}

/** 获取合同详情（含 allocations） */
export function getContract(contractId: number): Promise<Contract> {
  return request.get(`${BASE}/${contractId}`);
}

/** 创建合同 */
export function createContract(data: CreateContractRequest): Promise<Contract> {
  return request.post(BASE, data);
}

/** 更新合同 */
export function updateContract(
  contractId: number,
  data: UpdateContractRequest,
): Promise<Contract> {
  return request.patch(`${BASE}/${contractId}`, data);
}

/** 软删除合同 */
export function softDeleteContract(contractId: number): Promise<void> {
  return request.delete(`${BASE}/${contractId}`);
}

// ---- 分配管理 ----
// 分配列表不再单独请求，通过 getContract() 的 detail.allocations 获取

/** 新增城市分配 */
export function createAllocation(
  contractId: number,
  data: Omit<CreateAllocationRequest, 'contractId'>,
): Promise<ContractCityAllocation> {
  return request.post(`${BASE}/${contractId}/allocations`, data);
}

/** 更新城市分配 */
export function updateAllocation(
  allocationId: number,
  data: UpdateAllocationRequest,
): Promise<ContractCityAllocation> {
  return request.patch(`/admin/allocations/${allocationId}`, data);
}

/** 删除城市分配 */
export function deleteAllocation(allocationId: number): Promise<void> {
  return request.delete(`/admin/allocations/${allocationId}`);
}

/** [危险] 物理清除所有合同及分配数据 */
export function purgeContracts(): Promise<{ success: boolean; message: string }> {
  return request.delete('/admin/contracts/all/purge');
}
