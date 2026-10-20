/**
 * 后评估（工程管理）API 客户端
 * 对应后端 apps/api/src/biz-assessments/biz-assessments.controller.ts
 * 路径前缀：/api/biz/assessment
 */
import axios from 'axios';
import { getBizToken } from '@/utils/biz-auth';

const request = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '/api', timeout: 60_000 });
request.interceptors.request.use((config) => {
  const token = getBizToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface AssessmentOverviewRow {
  id: string;
  source: 'import' | 'offline';
  evalMonth: string;
  projectName: string;
  cityId: string | null;
  cityName: string;
  supplierName: string;
  contractId: string | null;
  contractNo: string | null;
  score: number;
  grade: string | null;
  evalMethod: 'online' | 'offline';
  status: string;
  returnedBy: string | null;
  returnReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssessmentSummary {
  totalCount: number;
  supplierCount: number;
  cityCount: number;
  projectCount: number;
  avgScore: number;
  maxScore: number;
  minScore: number;
  onlineCount: number;
  offlineCount: number;
  importedCount: number;
  entryCount: number;
  months: Array<{ month: string; count: number; avgScore: number }>;
  cities: Array<{ cityId: string | null; cityName: string; count: number; avgScore: number; minScore: number }>;
  suppliers: Array<{ supplierName: string; count: number; avgScore: number; minScore: number }>;
  distribution: Array<{ bucket: string; count: number }>;
}

export interface AssessmentQuery {
  months?: string[];
  year?: string;
  cityIds?: string[];
  supplierName?: string;
  projectName?: string;
  evalMethod?: string;
  source?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export interface AssessmentPreviewIssue {
  rowNo: number;
  message: string;
}

export interface AssessmentPreviewSample {
  rowNo: number;
  srcSeq: number | null;
  evalMonth: string;
  projectName: string;
  cityName: string;
  supplierName: string;
  score: number;
  evalMethod: 'online' | 'offline';
}

export interface AssessmentPreview {
  filename: string;
  sheetName: string;
  headerMap: Record<string, string>;
  totalRows: number;
  duplicateRows: number;
  failedRows: number;
  issues: AssessmentPreviewIssue[];
  unmatchedCities: string[];
  months: string[];
  supplierCount: number;
  methodCount: { online: number; offline: number };
  sample: AssessmentPreviewSample[];
}

export interface AssessmentImportResult {
  batchId: string;
  totalRows: number;
  insertedRows: number;
  updatedRows: number;
  duplicateRows: number;
  failedRows: number;
  months: string[];
}

export interface AssessmentBatch {
  id: string;
  filename: string;
  fileSize: number | null;
  evalMonth: string | null;
  totalRows: number;
  validRows: number;
  duplicateRows: number;
  failedRows: number;
  insertedRows: number;
  updatedRows: number;
  status: string;
  uploadedAt: string;
}

export interface AssessmentEntryRow {
  id: string;
  evalMonth: string;
  projectName: string;
  cityId: string | null;
  cityName: string;
  supplierName: string;
  contractId: string | null;
  contractNo: string | null;
  score: number;
  evalMethod: 'online' | 'offline';
  status: string;
  submittedBy: string | null;
  submittedAt: string | null;
  returnedBy: string | null;
  returnedAt: string | null;
  returnReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssessmentEntryPayload {
  contractId: string;
  evalMonth: string;
  supplierName: string;
  score: number;
  cityId?: string | null;
  evalMethod?: 'online' | 'offline';
}

/** 数组型查询参数用逗号拼接，后端统一按逗号/多值解析 */
function toParams(query: AssessmentQuery): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  if (query.months?.length) params.months = query.months.join(',');
  if (query.cityIds?.length) params.cityIds = query.cityIds.join(',');
  for (const key of ['year', 'supplierName', 'projectName', 'evalMethod', 'source', 'status', 'page', 'pageSize'] as const) {
    const value = query[key];
    if (value !== undefined && value !== null && value !== '') params[key] = value;
  }
  return params;
}

// ==================== 概览 ====================

export async function assessmentOverview(query: AssessmentQuery): Promise<{ items: AssessmentOverviewRow[]; total: number; page: number; pageSize: number }> {
  return (await request.get('/biz/assessment/overview', { params: toParams(query) })).data;
}

export async function assessmentSummary(query: AssessmentQuery): Promise<AssessmentSummary> {
  return (await request.get('/biz/assessment/overview/summary', { params: toParams(query) })).data;
}

export async function assessmentOptions(): Promise<{
  months: string[];
  suppliers: string[];
  cities: Array<{ id: string; name: string }>;
  projects: string[];
}> {
  return (await request.get('/biz/assessment/overview/options')).data;
}

export async function assessmentExportRows(query: AssessmentQuery): Promise<{ items: AssessmentOverviewRow[]; total: number }> {
  return (await request.get('/biz/assessment/overview/export', { params: toParams(query) })).data;
}

// ==================== 数据导入 ====================

export async function assessmentBatches(): Promise<{ items: AssessmentBatch[] }> {
  return (await request.get('/biz/assessment/batches')).data;
}

export async function assessmentImportPreview(file: File): Promise<AssessmentPreview> {
  const form = new FormData();
  form.append('file', file);
  return (await request.post('/biz/assessment/import/preview', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120_000 })).data;
}

export async function assessmentImportCommit(file: File): Promise<AssessmentImportResult> {
  const form = new FormData();
  form.append('file', file);
  return (await request.post('/biz/assessment/import', form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 180_000 })).data;
}

export async function assessmentBatchDelete(id: string): Promise<{ deletedRecords: number }> {
  return (await request.delete(`/biz/assessment/batches/${encodeURIComponent(id)}`)).data;
}

// ==================== 线下填报 ====================

export async function assessmentEntries(params: {
  months?: string[];
  status?: string;
  cityIds?: string[];
  supplierName?: string;
  contractNo?: string;
}): Promise<{ items: AssessmentEntryRow[] }> {
  const query: Record<string, unknown> = {};
  if (params.months?.length) query.months = params.months.join(',');
  if (params.cityIds?.length) query.cityIds = params.cityIds.join(',');
  if (params.status) query.status = params.status;
  if (params.supplierName) query.supplierName = params.supplierName;
  if (params.contractNo) query.contractNo = params.contractNo;
  return (await request.get('/biz/assessment/entries', { params: query })).data;
}

export async function assessmentContractOptions(keyword?: string): Promise<{ items: Array<{ id: string; contractNo: string; contractName: string; provinceId: string }> }> {
  return (await request.get('/biz/assessment/entries/contract-options', { params: keyword ? { keyword } : {} })).data;
}

export async function assessmentCityOptions(contractId: string): Promise<{ items: Array<{ id: string; name: string }> }> {
  return (await request.get('/biz/assessment/entries/city-options', { params: contractId ? { contractId } : {} })).data;
}

export async function assessmentEntryCreate(payload: AssessmentEntryPayload): Promise<AssessmentEntryRow> {
  return (await request.post('/biz/assessment/entries', payload)).data;
}

export async function assessmentEntryUpdate(id: string, payload: Partial<AssessmentEntryPayload>): Promise<AssessmentEntryRow> {
  return (await request.patch(`/biz/assessment/entries/${encodeURIComponent(id)}`, payload)).data;
}

export async function assessmentEntrySubmit(id: string): Promise<AssessmentEntryRow> {
  return (await request.post(`/biz/assessment/entries/${encodeURIComponent(id)}/submit`)).data;
}

export async function assessmentEntryWithdraw(id: string): Promise<AssessmentEntryRow> {
  return (await request.post(`/biz/assessment/entries/${encodeURIComponent(id)}/withdraw`)).data;
}

export async function assessmentEntryReturn(id: string, reason: string): Promise<AssessmentEntryRow> {
  return (await request.post(`/biz/assessment/entries/${encodeURIComponent(id)}/return`, { reason })).data;
}

export async function assessmentEntryVoid(id: string, reason: string): Promise<AssessmentEntryRow> {
  return (await request.post(`/biz/assessment/entries/${encodeURIComponent(id)}/void`, { reason })).data;
}

export async function assessmentEntryDelete(id: string): Promise<{ ok: true }> {
  return (await request.delete(`/biz/assessment/entries/${encodeURIComponent(id)}`)).data;
}
