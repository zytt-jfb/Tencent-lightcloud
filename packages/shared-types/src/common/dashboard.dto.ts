/** Dashboard cards use the same filtered fact aggregation as the business summary. */
export interface DashboardStats {
  cityCount: number;
  contractCount: number;
  completionAmount: number;
  acceptanceAmount: number;
  invoiceAmount: number;
  orderAmount: number;
  actualCost: number;
  grossProfit: number;
  actualNetProfit: number;
  formulaVersion: string;
}

export interface AdminBusinessSummaryQuery { year: number }

export type AdminBusinessSummaryDataStatus = 'empty' | 'partial' | 'current';

export interface AdminBusinessSummaryItem {
  cityId: number;
  cityName: string;
  dataStatus: AdminBusinessSummaryDataStatus;
  completionTotal: number;
  acceptanceTotal: number;
  invoiceTotal: number;
  orderTotal: number;
  orderGrossProfit: number;
  costTotal: number;
  costRate: number;
  costIncomeRate: number;
  netProfit: number;
  netProfitRate: number;
  /** Compatibility field name; value is the number of months with effective fact data. */
  submittedMonthCount: number;
  contractCount: number;
}

export interface AdminBusinessSummaryResponse {
  year: number;
  formulaVersion: string;
  dataSources: {
    completionAmount: string;
    acceptanceAmount: string;
    invoiceAmount: string;
    orderAmount: string;
    actualCost: string;
    grossProfit: string;
    actualNetProfit: string;
  };
  items: AdminBusinessSummaryItem[];
  totals: {
    completionTotal: number;
    acceptanceTotal: number;
    invoiceTotal: number;
    orderTotal: number;
    orderGrossProfit: number;
    costTotal: number;
    netProfit: number;
    costRate: number;
    costIncomeRate: number;
    netProfitRate: number;
    cityCount: number;
    submittedMonthCount: number;
    contractCount: number;
  };
}
