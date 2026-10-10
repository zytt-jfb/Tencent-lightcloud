export type FactKind = 'cost' | 'order';
export type FactImportLifecycleStatus = 'processing' | 'current_effective' | 'effective_with_warning' | 'validation_failed';
export type FactVersionLifecycleStatus = 'current_effective' | 'effective_with_warning' | 'replaced';
export type FactSourceType =
  | 'excel_daily_reimbursement'
  | 'excel_mileage_subsidy'
  | 'excel_standard_cost'
  | 'excel_ecommerce_order'
  | 'manual'
  | 'reversal';

export interface FactValidationIssue {
  rowNumber: number;
  field: string;
  reason: string;
  suggestion: string;
  severity: 'warning' | 'blocking';
}

export interface FactImportResult {
  batchId: number;
  status: FactImportLifecycleStatus;
  idempotent: boolean;
  factKind: FactKind;
  templateType: string;
  totalRows: number;
  successRows: number;
  errorRows: number;
  warningCount: number;
  blockingErrorCount: number;
  issues: FactValidationIssue[];
}

export interface FactListQuery {
  page?: number;
  pageSize?: number;
  year?: number;
  month?: number;
  cityId?: number;
  /** Admin-only multi-city selection. City users are always scoped by JWT. */
  cityIds?: number[];
  contractId?: number;
  costCategory?: string;
  orderStatus?: string;
  sourceType?: string;
  keyword?: string;
}

export interface CostFactItem {
  id: number;
  cityId: number;
  cityName?: string;
  contractId: number;
  contractCode: string;
  contractName: string;
  occurredOn: string;
  periodYear: number;
  periodMonth: number;
  costCategoryCode: string;
  costSubtype: string | null;
  description: string;
  amount: number;
  actualSpender: string | null;
  advancePayer: string | null;
  receiptType: string | null;
  approvalNumber: string | null;
  approvalStatus: string | null;
  dingTalkDataId: string | null;
  mileage: number | null;
  sourceType: FactSourceType;
  importBatchId: number | null;
  versionNo: number;
  isReversed: boolean;
  updatedAt: string;
}

export interface OrderFactItem {
  id: number;
  cityId: number;
  cityName?: string;
  contractId: number;
  contractCode: string;
  contractName: string;
  purchaseOrderNo: string;
  orderStatus: string;
  taxInclusiveAmount: number;
  materialName: string;
  materialCode: string;
  projectCode: string | null;
  projectName: string | null;
  siteCode: string | null;
  siteName: string | null;
  orderedAt: string;
  periodYear: number;
  periodMonth: number;
  receiptStatus: string | null;
  sourceType: FactSourceType;
  importBatchId: number | null;
  businessKey: string;
  versionNo: number;
  isReversal: boolean;
  updatedAt: string;
}

export interface FactPage<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface CreateCostFactRequest {
  contractId: number;
  occurredOn: string;
  costCategoryCode: string;
  costSubtype?: string;
  description: string;
  amount: number;
  actualSpender?: string;
  advancePayer?: string;
  receiptType?: string;
  approvalNumber?: string;
  approvalStatus?: string;
  reason: string;
}

export interface UpdateCostFactRequest extends Partial<Omit<CreateCostFactRequest, 'reason'>> {
  reason: string;
  expectedVersionNo: number;
}

export interface CreateOrderFactRequest {
  contractId: number;
  purchaseOrderNo: string;
  orderStatus: string;
  taxInclusiveAmount: number;
  materialName: string;
  materialCode: string;
  projectCode?: string;
  projectName?: string;
  siteCode?: string;
  siteName?: string;
  orderedAt: string;
  receiptStatus?: string;
  reason: string;
}

export interface UpdateOrderFactRequest extends Partial<Omit<CreateOrderFactRequest, 'reason'>> {
  reason: string;
  expectedVersionNo: number;
}

export interface ReverseFactRequest {
  reason: string;
  expectedVersionNo: number;
}

export interface FactVersionQuery extends FactListQuery {
  factKind?: FactKind;
  lifecycleStatus?: FactVersionLifecycleStatus;
  dateFrom?: string;
  dateTo?: string;
}

export interface FactVersionItem {
  id: number;
  factKind: FactKind;
  factId: number;
  cityId: number | null;
  contractId: number | null;
  periodYear: number | null;
  periodMonth: number | null;
  versionNo: number;
  changeType: 'create' | 'update' | 'reverse';
  lifecycleStatus: FactVersionLifecycleStatus;
  supersedesVersionId: number | null;
  supersededByVersionId: number | null;
  changedFields: string[];
  warningSummary: FactValidationIssue[];
  reason: string;
  operatorUserId: number;
  sourceType: string;
  importBatchId: number | null;
  beforeData: unknown;
  afterData: unknown;
  createdAt: string;
}

export interface FactVersionConflictCurrent {
  factId: number;
  versionNo: number;
  updatedAt: string;
  updatedBy: number;
}

export interface FactAggregateItem {
  cityId: number;
  cityName: string;
  contractId: number;
  contractCode: string;
  contractName: string;
  actualCost: number;
  costBudget: number;
  orderAmount: number;
  completionAmount: number;
  acceptanceAmount: number;
  invoiceAmount: number;
  grossProfit: number;
  actualNetProfit: number;
  predictedGrossProfit: number;
  predictedNetProfit: number;
  effectiveRate: number;
  updatedAt: string | null;
}

export interface FactAggregateResponse {
  scope: 'city' | 'selection' | 'province';
  /** Distinct months represented by progress, cost, or order facts in a city-scoped response. */
  dataMonthCount?: number;
  items: FactAggregateItem[];
  totals: Omit<FactAggregateItem, 'cityId' | 'cityName' | 'contractId' | 'contractCode' | 'contractName' | 'effectiveRate' | 'updatedAt'>;
  cities?: Array<{
    cityId: number;
    cityName: string;
    contractCount: number;
    dataMonthCount: number;
    totals: Omit<FactAggregateItem, 'cityId' | 'cityName' | 'contractId' | 'contractCode' | 'contractName' | 'effectiveRate' | 'updatedAt'>;
  }>;
  formulaVersion: 'facts-v1';
}

export interface ContractProgressFactItem {
  cityId: number;
  cityName: string;
  contractId: number;
  contractCode: string;
  contractName: string;
  year: number;
  month: number;
  completionAmount: number;
  acceptanceAmount: number;
  invoiceAmount: number;
}

export interface LocalContractItem extends FactAggregateItem {
  allocationAmount: number;
  signDate: string | null;
  expireDate: string | null;
}
