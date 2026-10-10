/**
 * Misc DTOs for reminders, imports, exports, and recalc tasks.
 */

export interface SendRemindersRequest {
  year: number;
  month: number;
  cityIds: number[];
}

export interface ConfirmImportRequest {
  confirmOverwrite: boolean;
  cityId?: number | null;
  reportYear?: number | null;
}

export interface CreateExportJobRequest {
  exportMode: 'current_realtime' | 'month_snapshot';
  scopeType: 'city' | 'all_cities';
  cityId?: number | null;
  reportYear: number;
  belongMonth?: number | null;
  snapshotRange?: 'month_only' | 'year_to_month' | null;
}

export interface RetryRecalcTaskRequest {
  retryMode: 'full' | 'failed_only';
}

export interface ImportPreviewResponse {
  id: number;
  status: string;
  parsedSummary: Record<string, unknown> | null;
  diffSummary: Record<string, unknown> | null;
  errorSummary: Record<string, unknown> | null;
  qualityIssues?: ImportQualityIssue[];
}

export interface ImportConfirmResponse {
  success: boolean;
  jobId: number;
  status?: string;
  alreadyConfirmed?: boolean;
}

export type ImportQualityIssueType =
  | 'template'
  | 'mapping'
  | 'duplicate'
  | 'scope'
  | 'parse'
  | 'validation';

export interface ImportQualityIssue {
  id: string;
  issueType: ImportQualityIssueType;
  severity: 'blocking' | 'warning';
  rowNo: number | null;
  sourceLocation: string;
  originalValue: string | null;
  description: string;
  blocking: boolean;
  suggestedOwner: 'system_admin' | 'city_user';
}

export interface ImportJobListItem {
  id: number;
  jobType: string;
  operatorUserId: number;
  operatorName: string | null;
  cityId: number | null;
  cityName: string | null;
  reportYear: number | null;
  status: string;
  sourceFileName: string | null;
  confirmedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImportJobDetail extends ImportJobListItem {
  sourceFileUrl: string;
  parsedSummary: Record<string, unknown> | null;
  diffSummary: Record<string, unknown> | null;
  errorSummary: Record<string, unknown> | null;
  qualityIssues: ImportQualityIssue[];
}

export interface ImportJobListResponse {
  items: ImportJobListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ImportJobCancelResponse {
  success: boolean;
  jobId: number;
  status: string;
}

/** D-04：导入任务重试响应（FAILED → PENDING）。 */
export interface ImportJobRetryResponse {
  success: boolean;
  jobId: number;
  status: string;
}

export interface ExportJobResponse {
  id: number;
  status: string;
  fileUrl: string | null;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface ExportCreateResponse {
  jobId: number;
  status: string;
}

export interface RecalcTaskItem {
  id: number;
  taskType: string;
  status: string;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RecalcTaskListResponse {
  items: RecalcTaskItem[];
  total: number;
}

export interface RecalcRetryResponse {
  success: boolean;
  taskId: number;
}
