import type { ExportAuditRequest } from '@biz-reporting/shared-types';
import request, { type RequestOptions } from '@/utils/request';
import { makeExportFileName, PAGE_EXPORT_ROW_LIMIT, writeWorkbook } from './page-export-core';

export { makeExportFileName, PAGE_EXPORT_ROW_LIMIT } from './page-export-core';

export async function auditPageExport(payload: ExportAuditRequest): Promise<void> {
  const options: RequestOptions = { suppressErrorToast: true };
  await request.post('/exports/audit', payload, options);
}

export async function exportPageWorkbook(input: {
  pageName: string;
  scope: string;
  period: string;
  filters: ExportAuditRequest['filters'];
  rowCount: number;
  sheets: Parameters<typeof writeWorkbook>[1];
}): Promise<string> {
  if (input.rowCount > PAGE_EXPORT_ROW_LIMIT) throw new Error('EXPORT_ROW_LIMIT_EXCEEDED');
  const fileName = makeExportFileName(input.pageName, input.scope, input.period);
  try {
    writeWorkbook(fileName, input.sheets);
    await auditPageExport({ pageName: input.pageName, scopeLabel: input.scope, filters: input.filters, rowCount: input.rowCount, result: 'success', fileName });
    return fileName;
  } catch (error) {
    await auditPageExport({ pageName: input.pageName, scopeLabel: input.scope, filters: input.filters, rowCount: input.rowCount, result: 'failed', fileName, errorCode: error instanceof Error ? error.message.slice(0, 80) : 'CLIENT_EXPORT_FAILED' }).catch(() => undefined);
    throw error;
  }
}
