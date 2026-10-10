import type {
  ImportConfirmResponse,
  ImportJobCancelResponse,
  ImportJobDetail,
  ImportJobListResponse,
  ImportPreviewResponse,
} from '@biz-reporting/shared-types';
import request, { postForm } from '@/utils/request';

export type ImportJobTypeValue = 'contract' | 'city_reporting' | 'city_cost';

export interface ImportJobListParams {
  cityId?: number;
  reportYear?: number;
  jobType?: ImportJobTypeValue;
  status?: string;
  page?: number;
  pageSize?: number;
}

export interface CreateImportJobInput {
  file: File;
  jobType: ImportJobTypeValue;
  reportYear?: number;
  cityId?: number;
}

function basePath(isSystemAdmin: boolean): string {
  return isSystemAdmin ? '/admin/import-jobs' : '/city/import-jobs';
}

export function listImportJobs(
  isSystemAdmin: boolean,
  params: ImportJobListParams,
): Promise<ImportJobListResponse> {
  return request.get(basePath(isSystemAdmin), { params });
}

export function createImportJob(
  isSystemAdmin: boolean,
  input: CreateImportJobInput,
): Promise<ImportJobDetail> {
  const formData = new FormData();
  formData.append('file', input.file);
  formData.append('jobType', input.jobType);
  if (input.reportYear !== undefined) formData.append('reportYear', String(input.reportYear));
  if (input.cityId !== undefined) formData.append('cityId', String(input.cityId));
  return postForm(basePath(isSystemAdmin), formData);
}

export function getImportJob(
  isSystemAdmin: boolean,
  jobId: number,
): Promise<ImportJobDetail> {
  return request.get(`${basePath(isSystemAdmin)}/${jobId}`);
}

export function previewImportJob(
  isSystemAdmin: boolean,
  jobId: number,
): Promise<ImportPreviewResponse> {
  return request.get(`${basePath(isSystemAdmin)}/${jobId}/preview`);
}

export function confirmImportJob(
  isSystemAdmin: boolean,
  jobId: number,
  confirmOverwrite: boolean,
): Promise<ImportConfirmResponse> {
  return request.post(`${basePath(isSystemAdmin)}/${jobId}/confirm`, { confirmOverwrite });
}

export function cancelImportJob(
  isSystemAdmin: boolean,
  jobId: number,
): Promise<ImportJobCancelResponse> {
  return request.post(`${basePath(isSystemAdmin)}/${jobId}/cancel`, {});
}
