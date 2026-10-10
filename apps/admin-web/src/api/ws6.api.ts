import request, { postForm, getBlob } from '@/utils/request';
import type {
  ConfirmImportRequest,
  CreateExportJobRequest,
  ExportCreateResponse,
  ExportJobResponse,
  ImportConfirmResponse,
  ImportPreviewResponse,
  RecalcRetryResponse,
  RecalcTaskListResponse,
} from '@biz-reporting/shared-types';

export interface CreateImportJobResponse {
  jobId: number;
  status: string;
  filename?: string;
  sourceFileUrl?: string;
}

// ============================================================
// 后台管理端（系统管理员）导入 / 导出 / 重算接口。
// 统一走 axios 单例（request / postForm / getBlob），不再使用孤立的 fetch + getToken。
// 地市端导入请使用 @/api/city-import-jobs.api（/api/city/import-jobs）。
// ============================================================

export function uploadContracts(file: File): Promise<CreateImportJobResponse> {
  const formData = new FormData();
  formData.append('file', file);
  return postForm('/admin/imports/contracts/upload', formData);
}

export function uploadReporting(file: File, cityId?: number | null): Promise<CreateImportJobResponse> {
  const formData = new FormData();
  formData.append('file', file);
  if (cityId) formData.append('cityId', String(cityId));
  return postForm('/admin/imports/reporting/upload', formData);
}

export function getImportPreview(jobId: number, cityId?: number | null): Promise<ImportPreviewResponse> {
  return request.get(`/imports/${jobId}/preview`, cityId ? { params: { cityId } } : undefined);
}

export function confirmImport(jobId: number, body: ConfirmImportRequest): Promise<ImportConfirmResponse> {
  return request.post(`/imports/${jobId}/confirm`, body);
}

export function downloadExport(jobId: number): Promise<Blob> {
  return getBlob(`/exports/${jobId}/download`);
}

export function createExportJob(data: CreateExportJobRequest): Promise<ExportCreateResponse> {
  return request.post('/exports', data);
}

export function getExportJob(jobId: number): Promise<ExportJobResponse> {
  return request.get(`/exports/${jobId}`);
}

export function listRecalcTasks(): Promise<RecalcTaskListResponse> {
  return request.get('/admin/recalc-tasks');
}

export function retryRecalcTask(taskId: number): Promise<RecalcRetryResponse> {
  return request.post(`/admin/recalc-tasks/${taskId}/retry`, { retryMode: 'full' });
}
