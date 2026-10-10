import type { FactImportLifecycleStatus } from '@biz-reporting/shared-types';
import request from '@/utils/request';

export interface FactImportBatchItem {
  id: number; factKind: 'cost' | 'order'; templateType: string; cityId: number; operatorUserId: number;
  sourceFileName: string; sourceFileSha256: string; sourceFileStorageKey: string | null; sourceFileSize: number | null;
  sourceFileStoredAt: string | null; status: 'processing' | 'completed' | 'failed'; lifecycleStatus: FactImportLifecycleStatus;
  totalRows: number; successRows: number; errorRows: number; warningCount: number; blockingErrorCount: number;
  errors: unknown; result: unknown; uploadedAt: string; completedAt: string | null; effectiveAt: string | null;
}
export interface FactImportBatchDetail extends FactImportBatchItem {
  sourceFileAvailable: boolean;
  lineage: {
    sourceRows: Array<{ id: number; sheetName: string; rowNumber: number; status: string; rowHash: string }>;
    costFacts: Array<{ id: number; sourceRowId: number; versionNo: number }>;
    orderFacts: Array<{ id: number; sourceRowId: number; versionNo: number }>;
    factVersions: Array<{ id: number; factId: number; factType: string; versionNo: number }>;
    operationLogIds: number[];
  };
}
export const factBatchesApi = {
  adminList: (cityId?: number) => request.get('/admin/facts/import-batches', { params: { cityId } }) as Promise<FactImportBatchItem[]>,
  adminDetail: (id: number) => request.get(`/admin/facts/import-batches/${id}`) as Promise<FactImportBatchDetail>,
};
