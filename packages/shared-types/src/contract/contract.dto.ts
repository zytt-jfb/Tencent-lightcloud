/**
 * 合同管理 DTO
 * 来源：OpenAPI YAML — Contracts + Allocations tags
 */

/** 创建 / 更新合同请求 */
export interface CreateContractRequest {
  contractCode: string;
  contractName: string;
  contractAmount: number;
  rate: number;
  signDate?: string | null;    // date string, optional on create
  expireDate?: string | null;  // date string, optional on create
}

/** 更新合同 = 继承创建字段 */
export type UpdateContractRequest = CreateContractRequest;

/** 创建分配请求 */
export interface CreateAllocationRequest {
  contractId: number;
  cityId: number;
  cityContractAmount: number;
  rate?: number;
  accumulatedOrderAmount?: number;
  accumulatedInvoiceAmount?: number;
  estimatedOrderAmount2026?: number;
  estimatedIncomeAmount2026?: number;
  remark?: string | null;
  sourceCityName?: string | null;
}

/** 更新分配 = 继承创建字段 */
export type UpdateAllocationRequest = CreateAllocationRequest;
