import type { DraftSaveRequest, SubmitPreviewResponse } from '@biz-reporting/shared-types';
import request from '@/utils/request';

export interface CityPackageMonthStatus {
  monthNo: number;
  submitted: boolean;
  overdue: boolean;
}

export interface CityPackageSummary {
  completionTotal: number;
  acceptanceTotal: number;
  invoiceTotal?: number;
  orderTotal?: number;
  costTotal: number;
  costCategoryTotals?: Record<string, number> | null;
  orderGrossProfit: number;
  grossProfit: number;
  costRate: number;
  costIncomeRate: number;
  netProfit: number;
  netProfitRate: number;
}

export interface CityPackageResponse {
  id: number;
  cityId: number;
  reportYear: number;
  status: string;
  months: CityPackageMonthStatus[];
  contractCount: number;
  summary: CityPackageSummary | null;
}

export interface CityContractRow {
  contractId: number;
  contractCode: string;
  contractName: string;
  completionAmount: number;
  acceptanceAmount: number;
  invoiceAmount: number | null;
  orderAmount: number | null;
}

export interface CityMonthResponse {
  packageId: number;
  cityId: number;
  reportYear: number;
  monthNo: number;
  contractRows: CityContractRow[];
  costRows: Array<{ costCategoryCode: string; amount: number }>;
  maintenanceRow: {
    invoiceTotalPrevYear: number;
    invoiceMonthCountPrevYear: number;
    invoiceTotalCurrentYear: number;
  } | null;
  isLocked: boolean;
  isSubmitted: boolean;
  lockReason: string | null;
}

export interface CityDraftSaveResponse {
  success: boolean;
  packageId: number;
  monthNo: number;
  savedAt: string;
}

export interface CitySubmitResponse {
  success: boolean;
  packageId: number;
  monthNo: number;
  submittedAt: string;
  snapshotId: number;
}

export function getCurrentPackage(year: number): Promise<CityPackageResponse> {
  return request.get('/city/packages/current', { params: { year } });
}

export function getMonthData(packageId: number, monthNo: number): Promise<CityMonthResponse> {
  return request.get(`/city/packages/${packageId}/months/${monthNo}`);
}

export function saveDraft(packageId: number, data: DraftSaveRequest): Promise<CityDraftSaveResponse> {
  return request.post(`/city/packages/${packageId}/draft-save`, data);
}

export function previewSubmit(packageId: number, data: DraftSaveRequest): Promise<SubmitPreviewResponse> {
  return request.post(`/city/packages/${packageId}/submit-preview`, data);
}

export function submitMonth(packageId: number, data: DraftSaveRequest): Promise<CitySubmitResponse> {
  return request.post(`/city/packages/${packageId}/submit`, data);
}
