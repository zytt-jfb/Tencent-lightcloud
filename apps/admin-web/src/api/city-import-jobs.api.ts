/**
 * 地市端导入作业 API（唯一入口）。
 *
 * 新前端一律通过本模块调用 /api/city/import-jobs 系列接口：
 *  - 身份链以后端 job 自身绑定的 city_id / report_year / operator 为准；
 *  - 前端不再回传 cityId / reportYear（创建时除外，用于绑定年份）；
 *  - 统一走 axios 单例（postForm / request），自动附带 Authorization。
 *
 * 旧地市路径 /api/city/imports/* 与 /api/imports/* 已降级隔离，禁止在此调用。
 */
import request, { postForm } from '@/utils/request';

export type CityImportJobType = 'city_reporting' | 'city_cost';

export interface CityImportJobResponse {
  jobId: number;
  status: string;
  jobType: string;
  operatorUserId: number;
  cityId: number | null;
  reportYear: number | null;
  filename?: string;
  sourceFileName?: string | null;
  sourceFileUrl?: string | null;
  parsedSummary?: Record<string, unknown> | null;
  diffSummary?: Record<string, unknown> | null;
  errorSummary?: Record<string, unknown> | null;
  confirmedAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface CityImportPreviewResponse {
  jobId: number;
  status: string;
  parsedSummary: Record<string, unknown> | null;
  diffSummary: Record<string, unknown> | null;
  errorSummary: Record<string, unknown> | null;
}

export interface CityImportConfirmResponse {
  success: boolean;
  jobId: number;
}

export interface CityImportCancelResponse {
  success: boolean;
  jobId: number;
  status: string;
}

/** 创建导入作业（报表/成本），绑定当前登录用户与地市，指定报表年份。 */
export function createCityImportJob(
  file: File,
  jobType: CityImportJobType,
  reportYear: number,
): Promise<CityImportJobResponse> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('jobType', jobType);
  formData.append('reportYear', String(reportYear));
  return postForm('/city/import-jobs', formData);
}

/** 获取导入作业详情。 */
export function getCityImportJob(jobId: number): Promise<CityImportJobResponse> {
  return request.get(`/city/import-jobs/${jobId}`);
}

/** 触发/获取导入预览（使用作业自身绑定的地市与年份）。 */
export function previewCityImportJob(jobId: number): Promise<CityImportPreviewResponse> {
  return request.get(`/city/import-jobs/${jobId}/preview`);
}

/** 确认导入写入。 */
export function confirmCityImportJob(
  jobId: number,
  confirmOverwrite: boolean,
): Promise<CityImportConfirmResponse> {
  return request.post(`/city/import-jobs/${jobId}/confirm`, { confirmOverwrite });
}

/** 取消导入作业。 */
export function cancelCityImportJob(jobId: number): Promise<CityImportCancelResponse> {
  return request.post(`/city/import-jobs/${jobId}/cancel`, {});
}
