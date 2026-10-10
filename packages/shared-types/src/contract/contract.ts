/**
 * 合同实体
 * 来源：DDL contracts 表
 *
 * 重要业务规则：
 * - 支持软删除（is_deleted），已删除合同不影响已有快照
 * - accumulated_order_amount / accumulated_invoice_amount 为累计值
 */
export interface Contract {
  id: number;
  contractCode: string;
  contractName: string;
  contractAmount: number;
  rate: number;
  accumulatedOrderAmount: number;
  accumulatedInvoiceAmount: number;
  signDate: Date | null;
  expireDate: Date | null;
  isDeleted: boolean;
  deletedAt: Date | null;
  createdBy: number;
  updatedBy: number;
  createdAt: Date;
  updatedAt: Date;
  allocations?: ContractCityAllocation[];
}

/**
 * 合同跨地市分配
 * 来源：DDL contract_city_allocations 表
 *
 * 业务说明：一个合同可以分配给多个城市，每个城市的分配金额独立统计
 */
export interface ContractCityAllocation {
  id: number;
  contractId: number;
  cityId: number;
  cityContractAmount: number;
  rate: number;
  accumulatedOrderAmount: number;
  accumulatedInvoiceAmount: number;
  estimatedOrderAmount2026: number;
  estimatedIncomeAmount2026: number;
  remark: string | null;
  sourceCityName: string | null;
  createdAt: Date;
  updatedAt: Date;
}
