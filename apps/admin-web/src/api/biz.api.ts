/**
 * biz（新基线）API 客户端
 * 对应后端：POST /api/biz/auth/login、GET /api/biz/auth/me、
 *          GET /api/biz/portal/modules、GET /api/biz/portal/placeholder/:code、
 *          /api/biz/admin/**
 */
import axios from 'axios';
import { getBizToken } from '@/utils/biz-auth';
import { computeEffectiveContractStatus } from '@biz-reporting/shared-types';

const request = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '/api' });

request.interceptors.request.use((config) => {
  const token = getBizToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export interface BizLoginResult {
  accessToken: string;
  expiresIn: number;
  user: { id: string; username: string; name: string; roleCode: string; cityId: string | null; sensitiveOrderScope: string };
}

export interface BizMeResult {
  id: string;
  username: string;
  roleCode: string;
  cityId: string | null;
  sensitiveOrderScope: string;
  permissions: string[];
  dataScope: { scopeType: string; provinceIds: string[]; cityIds: string[]; cityId: string | null };
}

export interface BizModuleItem {
  id: string;
  code: string;
  name: string;
  level: string;
  parentId?: string | null;
  sortOrder: number;
}

export function bizLogin(username: string, password: string): Promise<BizLoginResult> {
  return request.post('/biz/auth/login', { username, password }).then((r) => r.data);
}

export function bizMe(): Promise<BizMeResult> {
  return request.get('/biz/auth/me').then((r) => r.data);
}

export function bizChangeOwnPassword(data: { currentPassword: string; newPassword: string; confirmPassword: string }): Promise<{ ok: boolean }> {
  return request.patch('/biz/auth/me/password', data).then((r) => r.data);
}

export function bizPortalModules(): Promise<{ level1: BizModuleItem[]; level2: BizModuleItem[] }> {
  return request.get('/biz/portal/modules').then((r) => r.data);
}

export function bizPlaceholder(code: string): Promise<{ code: string; found: boolean; message: string; accessible?: boolean }> {
  return request.get(`/biz/portal/placeholder/${code}`).then((r) => r.data);
}

// ================= 账号与权限管理（仅 super_admin） =================

export function bizAdminListUsers(): Promise<{ items: Array<Record<string, unknown>> }> {
  return request.get('/biz/admin/users').then((r) => r.data);
}

export function bizAdminCreateUser(dto: {
  username: string; password: string; name: string; roleCode: string; cityIds?: string[] | null;
}): Promise<Record<string, unknown>> {
  return request.post('/biz/admin/users', dto).then((r) => r.data);
}

export function bizAdminSetUserStatus(id: string, status: 'enabled' | 'disabled'): Promise<Record<string, unknown>> {
  return request.patch(`/biz/admin/users/${id}/status`, { status }).then((r) => r.data);
}

export function bizAdminResetPassword(id: string, newPassword: string): Promise<{ ok: boolean }> {
  return request.post(`/biz/admin/users/${id}/reset-password`, { newPassword }).then((r) => r.data);
}

export function bizAdminGetUserPermissions(id: string): Promise<{ roleCode: string; base: string[]; overrides: Array<{ permissionCode: string; effect: 'allow' | 'deny' }>; effective: string[] }> {
  return request.get(`/biz/admin/users/${id}/permissions`).then((r) => r.data);
}

export function bizAdminSetOverrides(id: string, overrides: Array<{ permissionCode: string; effect: 'allow' | 'deny' }>): Promise<{ ok: boolean }> {
  return request.put(`/biz/admin/users/${id}/permission-overrides`, { overrides }).then((r) => r.data);
}

export function bizAdminSetDataScopes(id: string, scopes: Array<{ provinceId: string | null; cityId?: string | null }>): Promise<{ ok: boolean }> {
  return request.put(`/biz/admin/users/${id}/data-scopes`, { scopes }).then((r) => r.data);
}
export type BizScopeGrant = { scopeType: 'all' | 'province' | 'city' | 'contract'; targetId?: string | null; effect?: 'allow' | 'deny' };
export function bizAdminGetUserAccess(id: string): Promise<{ roles: Array<{ roleCode: string; isPrimary: boolean }>; grants: BizScopeGrant[] }> {
  return request.get(`/biz/admin/users/${id}/access`).then((r) => r.data);
}
export function bizAdminSetUserAccess(id: string, roles: string[], grants: BizScopeGrant[]): Promise<{ ok: boolean }> {
  return request.put(`/biz/admin/users/${id}/access`, { roles, grants }).then((r) => r.data);
}

export function bizAdminRoles(): Promise<{ items: Array<{ id: string; code: string; name: string }> }> {
  return request.get('/biz/admin/roles').then((r) => r.data);
}

export function bizAdminModules(): Promise<{ items: unknown[] }> {
  return request.get('/biz/admin/modules').then((r) => r.data);
}

export function bizAdminPermissions(): Promise<{ items: Array<{ code: string; name: string; moduleId: string; action: string }> }> {
  return request.get('/biz/admin/permissions').then((r) => r.data);
}

export function bizAdminProvinces(): Promise<{ items: Array<{ id: string; code: string; name: string }> }> {
  return request.get('/biz/admin/provinces').then((r) => r.data);
}

export function bizAdminCities(provinceId?: string): Promise<{ items: Array<{ id: string; code: string; name: string; provinceId: string; unitType?: 'city' | 'province_branch' }> }> {
  return request.get('/biz/admin/cities', { params: provinceId ? { provinceId } : {} }).then((r) => r.data);
}

/** 当前登录账号数据范围内的城市清单（不需要管理权限；city_user→其绑定城市，admin/super→全部） */
export function bizCities(): Promise<{ items: Array<{ id: string; code: string; name: string; provinceId: string; unitType?: 'city' | 'province_branch' }> }> {
  return request.get('/biz/cities').then((r) => r.data);
}

/** 当前登录账号数据范围内的省份清单（不需要管理权限；按 cityIds/provinceIds/allowAll 推导） */
export function bizProvinces(): Promise<{ items: Array<{ id: string; code: string; name: string }> }> {
  return request.get('/biz/provinces').then((r) => r.data);
}

export function bizAdminCreateProvince(dto: { code: string; name: string }): Promise<Record<string, unknown>> { return request.post('/biz/admin/provinces', dto).then((r) => r.data); }
export function bizAdminUpdateProvince(id: string, dto: Partial<{ code: string; name: string }>): Promise<Record<string, unknown>> { return request.patch(`/biz/admin/provinces/${id}`, dto).then((r) => r.data); }
export function bizAdminDeleteProvince(id: string): Promise<{ ok: boolean }> { return request.delete(`/biz/admin/provinces/${id}`).then((r) => r.data); }
export function bizAdminCreateCity(dto: { provinceId: string; code: string; name: string; unitType?: 'city' | 'province_branch' }): Promise<Record<string, unknown>> { return request.post('/biz/admin/cities', dto).then((r) => r.data); }
export function bizAdminUpdateCity(id: string, dto: Partial<{ provinceId: string; code: string; name: string; unitType: 'city' | 'province_branch' }>): Promise<Record<string, unknown>> { return request.patch(`/biz/admin/cities/${id}`, dto).then((r) => r.data); }
export function bizAdminDeleteCity(id: string): Promise<{ ok: boolean }> { return request.delete(`/biz/admin/cities/${id}`).then((r) => r.data); }

export type BizSuperDeleteResource =
  | 'maintenance-personnel' | 'maintenance-vehicle' | 'maintenance-generator'
  | 'order-import-record' | 'order-row' | 'contract-import-record' | 'contract'
  | 'contract-allocation' | 'contract-fee-rate' | 'contract-alert' | 'offline-completion'
  | 'cost-entry' | 'cost-category' | 'province' | 'city' | 'city-alias'
  | 'announcement' | 'announcement-read' | 'message' | 'operation-log';

export interface BizSuperDeleteListItem {
  id: string;
  label: string;
  details: string;
  createdAt: string | null;
}

export function bizSuperDeleteResources(): Promise<{ items: Array<{ code: BizSuperDeleteResource; label: string }> }> {
  return request.get('/biz/admin/data/resources').then((r) => r.data);
}

export function bizSuperDeleteList(resource: BizSuperDeleteResource): Promise<{ items: BizSuperDeleteListItem[] }> {
  return request.get(`/biz/admin/data/${resource}`).then((r) => r.data);
}

export function bizSuperDelete(resource: BizSuperDeleteResource, id: string): Promise<{ resource: BizSuperDeleteResource; id: string; deleted: Record<string, number> }> {
  return request.delete(`/biz/admin/data/${resource}/${id}`).then((r) => r.data);
}

// ================= 合同域（M3） =================

export interface BizContractItem {
  id: string;
  contractNo: string;
  contractName: string;
  taxInclusiveAmountFen: number;
  provinceId: string;
  provinceName?: string;
  startDate?: string | null;
  endDate?: string | null;
  status: string;
  /** 有效展示状态：active(执行中，未到期)/expired(已到期)/completed/voided/draft/cancelled；由服务端按判断基准日计算 */
  effectiveStatus?: string | null;
  /** 判断基准日 'YYYY-MM-DD'（快照页=快照 asOf；实时页=服务端当日）；旧接口可能缺失 */
  statusAsOf?: string | null;
  tags?: string[] | null;
  amountLocked?: boolean;
  parentContractId?: string | null;
  deletedAt?: string | null;
}

export interface BizContractDetail {
  contract: {
    id: string; contractNo: string; contractName: string; taxInclusiveAmountFen: number;
    taxExclusiveAmountFen: number | null; provinceId: string; startDate: string | null; endDate: string | null;
    status: string; effectiveStatus?: string | null; statusAsOf?: string | null; tags: string[]; amountLocked: boolean; voidSummaryChoice: string | null;
    parentContractId: string | null; versionNo: number; createdAt: string;
    archiveContractNo?: string | null; projectIdentityCode?: string | null; contractCategory1?: string | null; contractCategory2?: string | null;
    winningProjectName?: string | null; signedDate?: string | null; taxRateRaw?: string | null; taxRateBp?: number | null;
    sourceImportRecordId?: string | null; sourceSheetId?: string | null; sourceRowNo?: number | null;
  };
  allocations: Array<{
    cityId: string; cityName: string; quotaFen: number; status: string; completionFen: number;
    progress: number; overrunFen: number; orderCompletionFen: number; offlineCompletionFen: number;
  }>;
  feeRates: Array<{ cityId: string; effectiveMonth: string; rateBp: number; changeReason: string | null }>;
  activationIssues?: string[];
  alerts: Array<{ alertType: string; firstTriggeredAt: string }>;
  progress: {
    orderCompletionFen: number; offlineCompletionFen: number; totalCompletionFen: number;
    contractAmountFen: number; progress: number; progressBasis: string; quotaFen: number | null;
    remainingFen: number; overrunFen: number;
  };
  finance?: {
    referenceCostFen: number; grossProfitFen: number; referenceNetProfitFen: number; isReference: boolean;
  };
}

export function bizContractList(params?: { provinceId?: string; cityId?: string; status?: string; keyword?: string; includeDeleted?: boolean }): Promise<{ items: BizContractItem[] }> {
  return request.get('/biz/contracts', {
    params: { ...(params?.includeDeleted ? { includeDeleted: 'true' } : {}), provinceId: params?.provinceId, cityId: params?.cityId, status: params?.status, keyword: params?.keyword },
  }).then((r) => r.data);
}

export function bizContractOverview(params?: { provinceId?: string; cityId?: string; keyword?: string; startDate?: string; endDate?: string; status?: string }): Promise<{ items: BizContractItem[] }> {
  return request.get('/biz/contracts/overview', { params }).then((r) => r.data);
}

export interface BizPendingContractRow {
  id: string; sourceRowId: string; sourceRowNo: number; importRecordId: string; sheetName: string;
  contractNo: string; contractName: string; provinceId: string | null; provinceName: string; cityName: string;
  taxInclusiveAmountRaw: string; signedDateRaw: string; endDateRaw: string; validationError: string; status: 'needs_review'; isPendingImport: true;
}

export function bizPendingContractRows(keyword?: string): Promise<{ items: BizPendingContractRow[] }> {
  return request.get('/biz/contracts/pending-maintenance', { params: keyword ? { keyword } : {} }).then((r) => r.data);
}

export function bizMaintainPendingContractRow(sourceRowId: string, dto: { contractNo: string; contractName: string; provinceId: string; cityIds: string[]; taxInclusiveAmountFen: number; taxExclusiveAmountFen?: number | null; startDate?: string | null; endDate?: string | null; signedDate?: string | null; reason?: string | null }): Promise<BizContractItem> {
  return request.post(`/biz/contracts/pending-maintenance/${sourceRowId}`, dto).then((r) => r.data);
}

export function bizContractCreate(dto: {
  contractNo: string; contractName: string; taxInclusiveAmountFen: number;
  provinceId: string; startDate?: string | null; endDate?: string | null; parentContractId?: string | null;
}): Promise<BizContractItem> {
  return request.post('/biz/contracts', dto).then((r) => r.data);
}

export interface BizContractImportRecord {
  id: string; filename: string; status: string; sheetCount: number; totalRows: number; validRows: number; reviewRows: number; uploadedBy: string; uploadedAt: string; failureReason?: string | null;
}

export function bizContractUpload(file: File): Promise<{ importRecordId: string; created: number; allocations: number; contractNos: string[]; sheetCount: number; totalRows: number; validRows: number; reviewRows: number; issues: string[] }> {
  const form = new FormData();
  form.append('file', file);
  return request.post('/biz/contracts/upload', form, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
}

export function bizContractImportRecords(): Promise<{ items: BizContractImportRecord[] }> {
  return request.get('/biz/contracts/import-records').then((r) => r.data);
}

export function bizContractImportRecordDetail(id: string): Promise<{ record: BizContractImportRecord; sheets: Array<Record<string, unknown>>; issues: Array<Record<string, unknown>> }> {
  return request.get(`/biz/contracts/import-records/${id}`).then((r) => r.data);
}

export async function bizContractImportRecordDownload(id: string): Promise<Blob> {
  const response = await request.get(`/biz/contracts/import-records/${id}/source-workbook`, { responseType: 'blob' });
  return response.data as Blob;
}

export function bizContractImportRecordDelete(id: string): Promise<{ ok: boolean }> {
  return request.delete(`/biz/contracts/import-records/${id}`).then((r) => r.data);
}

export function bizContractDetail(id: string): Promise<BizContractDetail> {
  return request.get(`/biz/contracts/${id}`).then((r) => r.data);
}

export function bizContractUpdate(id: string, dto: Record<string, unknown>): Promise<BizContractItem> {
  return request.patch(`/biz/contracts/${id}`, dto).then((r) => r.data);
}

export function bizContractActivate(id: string): Promise<BizContractItem> {
  return request.post(`/biz/contracts/${id}/activate`).then((r) => r.data);
}

export interface BizContractBatchActivateResult {
  checked: number;
  activated: string[];
  failed: Array<{ id: string; contractNo?: string; reason: string }>;
}

export function bizContractBatchActivate(ids: string[], dryRun = false): Promise<BizContractBatchActivateResult> {
  return request.post('/biz/contracts/batch-activate', { ids, dryRun }).then((r) => r.data);
}

export function bizContractBatchClearDrafts(ids: string[]): Promise<{ cleared: number; skipped: Array<{ id: string; contractNo?: string; reason: string }> }> {
  return request.post('/biz/contracts/batch-clear-drafts', { ids }).then((r) => r.data);
}

export function bizContractVoid(id: string, summaryChoice: string, reason: string): Promise<BizContractItem> {
  return request.post(`/biz/contracts/${id}/void`, { summaryChoice, reason }).then((r) => r.data);
}

export function bizContractUpsertAllocation(id: string, cityId: string, quotaFen: number): Promise<unknown> {
  return request.post(`/biz/contracts/${id}/allocations`, { cityId, quotaFen }).then((r) => r.data);
}

export function bizContractCancelAllocation(id: string, cityId: string): Promise<{ ok: boolean }> {
  return request.delete(`/biz/contracts/${id}/allocations/${cityId}`).then((r) => r.data);
}

export function bizContractAddFeeRate(id: string, cityId: string, effectiveMonth: string, rateBp: number, changeReason?: string): Promise<unknown> {
  return request.post(`/biz/contracts/${id}/fee-rates`, { cityId, effectiveMonth, rateBp, changeReason }).then((r) => r.data);
}

export function bizContractBatchFeeRates(id: string, dto: { cityIds: string[]; effectiveMonth: string; rateBp: number; changeReason?: string; overwrite?: boolean }): Promise<{ items: Array<Record<string, unknown>> }> {
  return request.post(`/biz/contracts/${id}/fee-rates/batch`, dto).then((r) => r.data);
}

export function bizContractCopyFeeRates(id: string, dto: { sourceMonth: string; targetMonth: string; cityIds?: string[]; overwrite?: boolean }): Promise<{ items: Array<Record<string, unknown>> }> {
  return request.post(`/biz/contracts/${id}/fee-rates/copy`, dto).then((r) => r.data);
}

// ================= 合同真正删除/批量操作（管理员，软删除+恢复） =================

export function bizContractDelete(id: string): Promise<BizContractItem> {
  return request.delete(`/biz/contracts/${id}`).then((r) => r.data);
}

export function bizContractBatchDelete(ids: string[]): Promise<{ checked: number; deleted: string[]; skipped: Array<{ id: string; contractNo?: string; reason: string }> }> {
  return request.post('/biz/contracts/batch-delete', { ids }).then((r) => r.data);
}

export function bizContractBatchUpdate(ids: string[], dto: Record<string, unknown>): Promise<{ checked: number; updated: string[]; skipped: Array<{ id: string; contractNo?: string; reason: string }> }> {
  return request.post('/biz/contracts/batch-update', { ids, dto }).then((r) => r.data);
}

export function bizContractBatchRestore(ids: string[]): Promise<{ checked: number; restored: string[]; skipped: Array<{ id: string; contractNo?: string; reason: string }> }> {
  return request.post('/biz/contracts/batch-restore', { ids }).then((r) => r.data);
}

export function bizContractRestore(id: string): Promise<BizContractItem> {
  return request.post(`/biz/contracts/${id}/restore`).then((r) => r.data);
}

export function bizContractExport(params?: { ids?: string[]; includeDeleted?: boolean; provinceId?: string; cityId?: string; status?: string; keyword?: string }): Promise<string> {
  return request.get('/biz/contracts/export', {
    params: {
      ...(params?.ids?.length ? { ids: params.ids.join(',') } : {}),
      ...(params?.includeDeleted ? { includeDeleted: 'true' } : {}),
      ...(params?.provinceId ? { provinceId: params.provinceId } : {}),
      ...(params?.cityId ? { cityId: params.cityId } : {}),
      ...(params?.status ? { status: params.status } : {}),
      ...(params?.keyword ? { keyword: params.keyword } : {}),
    },
    responseType: 'text',
  }).then((r) => r.data);
}

// ================= 订单域（M4） =================

export async function bizOrderUpload(file: File, idempotencyKey: string, onProgress?: (percent: number) => void, sourceBatchId?: string): Promise<{ batchId: string; status: string }> {
  if (!file.size || file.size > 50 * 1024 * 1024) throw new Error('文件不能为空且不能超过 50MB');
  const partSize = 4 * 1024 * 1024;
  const count = Math.ceil(file.size / partSize);
  for (let index = 0; index < count; index += 1) {
    const form = new FormData();
    form.append('key', idempotencyKey);
    form.append('index', String(index));
    form.append('count', String(count));
    form.append('filename', file.name);
    if (sourceBatchId) form.append('sourceBatchId', sourceBatchId);
    form.append('file', file.slice(index * partSize, (index + 1) * partSize), 'part.bin');
    await request.post('/biz/orders/upload-part', form, {
      timeout: 120_000,
      onUploadProgress: (event) => {
        if (event.total) onProgress?.(Math.round((index + event.loaded / event.total) / count * 100));
      },
    });
  }
  return request.post('/biz/orders/upload-complete', { key: idempotencyKey }, { timeout: 10 * 60_000 }).then((r) => r.data);
}

export async function bizOrderReviewExport(id: string): Promise<Blob> {
  const response = await request.get(`/biz/orders/batches/${id}/review-export`, { responseType: 'blob' });
  return response.data as Blob;
}

export function bizOrderBatches(): Promise<{ items: Array<Record<string, unknown>> }> {
  return request.get('/biz/orders/batches').then((r) => r.data);
}

export function bizOrderBatchDetail(id: string): Promise<{ batch: Record<string, unknown>; errors: Array<Record<string, unknown>>; rowCount: number; missingRateCount?: number }> {
  return request.get(`/biz/orders/batches/${id}`).then((r) => r.data);
}

export function bizOrderBatchDelete(id: string): Promise<{ ok: boolean }> {
  return request.delete(`/biz/orders/batches/${id}`).then((r) => r.data);
}

export function bizOrderBatchVoid(id: string, reason: string): Promise<{ ok: boolean }> {
  return request.post(`/biz/orders/batches/${id}/void`, { reason }).then((r) => r.data);
}

export function bizOrderBatchRestore(id: string): Promise<{ ok: boolean }> {
  return request.post(`/biz/orders/batches/${id}/restore`).then((r) => r.data);
}

export function bizOrderRows(filter?: { batchId?: string; cityId?: string; overrun?: 'city' | 'contract' | 'any'; validationStatus?: 'valid' | 'needs_review'; page?: number; pageSize?: number }): Promise<{ items: Array<Record<string, unknown>>; total: number; page: number; pageSize: number }> {
  return request.get('/biz/orders/rows', { params: filter }).then((r) => r.data);
}

export function bizOrderRowMaintain(id: string, dto: {
  provinceId: string; cityId: string; contractId: string; businessMonth: string;
  feeRateSnapshotBp?: number; reason?: string;
}): Promise<Record<string, unknown>> {
  return request.patch(`/biz/orders/rows/${id}`, dto).then((r) => r.data);
}

// ================= 线下完工（M5） =================

export interface OfflineCompletionDto {
  contractId: string;
  cityId: string;
  businessMonth: string;
  amountFen: number;
  summary: string;
  attachmentRef?: string | null;
}

export function bizOfflineList(params?: { cityId?: string; status?: string }): Promise<{ items: Array<Record<string, unknown>> }> {
  return request.get('/biz/offline-completions', { params }).then((r) => r.data);
}

export function bizOfflineCreate(dto: OfflineCompletionDto): Promise<Record<string, unknown>> {
  return request.post('/biz/offline-completions', dto).then((r) => r.data);
}

export function bizOfflineUpdate(id: string, dto: Partial<OfflineCompletionDto>): Promise<Record<string, unknown>> {
  return request.patch(`/biz/offline-completions/${id}`, dto).then((r) => r.data);
}

export function bizOfflineSubmit(id: string): Promise<Record<string, unknown>> {
  return request.post(`/biz/offline-completions/${id}/submit`).then((r) => r.data);
}

export function bizOfflineWithdraw(id: string): Promise<Record<string, unknown>> {
  return request.post(`/biz/offline-completions/${id}/withdraw`).then((r) => r.data);
}

export function bizOfflineApprove(id: string): Promise<Record<string, unknown>> {
  return request.post(`/biz/offline-completions/${id}/approve`).then((r) => r.data);
}

export function bizOfflineReject(id: string, comment: string): Promise<Record<string, unknown>> {
  return request.post(`/biz/offline-completions/${id}/reject`, { comment }).then((r) => r.data);
}

export function bizOfflineVoid(id: string, reason: string): Promise<Record<string, unknown>> {
  return request.post(`/biz/offline-completions/${id}/void`, { reason }).then((r) => r.data);
}

export function bizOfflineRestore(id: string): Promise<Record<string, unknown>> {
  return request.post(`/biz/offline-completions/${id}/restore`).then((r) => r.data);
}

// ================= 地市成本（M5，不关联合同） =================

export interface CostEntryDto {
  cityId: string;
  businessMonth: string;
  categoryCode: string;
  amountFen: number;
  description?: string | null;
}

export function bizCostList(params?: { cityId?: string; status?: string; businessMonth?: string; year?: string; categoryCode?: string }): Promise<{ items: Array<Record<string, unknown>> }> {
  return request.get('/biz/costs', { params }).then((r) => r.data);
}

export function bizCostCategories(): Promise<{ items: Array<{ id: string; code: string; name: string; status: string; sortOrder: number }> }> {
  return request.get('/biz/costs/categories/list').then((r) => r.data);
}

export function bizCostSaveMonthly(dto: { cityId?: string | null; businessMonth: string; submit?: boolean; entries: Array<{ categoryCode: string; amountFen?: number; description?: string | null }> }): Promise<{ items: Array<Record<string, unknown>> }> {
  return request.post('/biz/costs/monthly', dto).then((r) => r.data);
}

export function bizCostCreate(dto: CostEntryDto): Promise<Record<string, unknown>> {
  return request.post('/biz/costs', dto).then((r) => r.data);
}

export function bizCostUpdate(id: string, dto: Partial<CostEntryDto>): Promise<Record<string, unknown>> {
  return request.patch(`/biz/costs/${id}`, dto).then((r) => r.data);
}

export function bizCostSubmit(id: string): Promise<Record<string, unknown>> {
  return request.post(`/biz/costs/${id}/submit`).then((r) => r.data);
}

export function bizCostApprove(id: string): Promise<Record<string, unknown>> {
  return request.post(`/biz/costs/${id}/approve`).then((r) => r.data);
}

export function bizCostReject(id: string, comment: string): Promise<Record<string, unknown>> {
  return request.post(`/biz/costs/${id}/reject`, { comment }).then((r) => r.data);
}

export function bizCostReturnMonthly(dto: { cityId: string; businessMonth: string; comment: string }): Promise<{ items: Array<Record<string, unknown>> }> {
  return request.post('/biz/costs/monthly/return', dto).then((r) => r.data);
}

export function bizCostVoid(id: string, reason: string): Promise<Record<string, unknown>> {
  return request.post(`/biz/costs/${id}/void`, { reason }).then((r) => r.data);
}

export function bizCostRestore(id: string): Promise<Record<string, unknown>> {
  return request.post(`/biz/costs/${id}/restore`).then((r) => r.data);
}

// ================= 汇总/分析/设置（M6） =================

export function bizAnalysisOverview(params?: { year?: string; month?: string; provinceId?: string; cityId?: string }): Promise<{ orderCompletionFen: number; offlineCompletionFen: number; grossProfitFen: number; costFen: number; netProfitFen: number; contractCount: number; totalContractAmountFen: number; totalCompletionFen: number; monthCount: number }> {
  return request.get('/biz/analysis/overview', { params }).then((r) => r.data);
}

export function bizAnalysisTrend(limit = 12, cityId?: string, year?: string, provinceId?: string): Promise<{ items: Array<Record<string, unknown>> }> {
  return request.get('/biz/analysis/trend', { params: { limit, ...(provinceId ? { provinceId } : {}), ...(cityId ? { cityId } : {}), ...(year ? { year } : {}) } }).then((r) => r.data);
}

export function bizAnalysisByCity(year?: string, month?: string, provinceId?: string): Promise<{ items: Array<Record<string, unknown>> }> {
  return request.get('/biz/analysis/by-city', { params: { ...(provinceId ? { provinceId } : {}), ...(year ? { year } : {}), ...(month ? { month } : {}) } }).then((r) => r.data);
}

export function bizAnalysisOverrunList(params?: { year?: string; month?: string; provinceId?: string; cityId?: string }): Promise<{ items: Array<Record<string, unknown>> }> {
  return request.get('/biz/analysis/overrun-list', { params }).then((r) => r.data);
}

export function bizAnalysisYears(): Promise<{ items: string[] }> {
  return request.get('/biz/analysis/years').then((r) => r.data);
}

export function bizAnalysisAlerts(cityId?: string, provinceId?: string): Promise<{ items: Array<{ contractId: string; contractNo: string; contractName: string; alertType: string; endDate: string | null; status: string }> }> {
  return request.get('/biz/analysis/alerts', { params: { ...(provinceId ? { provinceId } : {}), ...(cityId ? { cityId } : {}) } }).then((r) => r.data);
}

/** 经营单位详情（只读聚合）：合同/成本/订单完工/线下完工明细 + 汇总指标（summary 为全量数据库聚合，与明细分页分离） */
export function bizAnalysisCityDetail(cityId: string, params?: { year?: string; months?: string[]; categoryCodes?: string[] }): Promise<{
  city: { id: string; name: string; provinceId: string; provinceName: string; unitType: 'city' | 'province_branch' };
  filters: { year: string | null; months: string[]; categoryCodes: string[] };
  summary: { contractCount: number; contractAmountFen: number; orderCompletionFen: number; offlineCompletionFen: number; costFen: number; grossProfitFen: number; netProfitFen: number };
  contracts: Array<Record<string, unknown>>;
  costs: Array<Record<string, unknown>>;
  costTotal: Record<string, number>;
  orderCompletions: Array<Record<string, unknown>>;
  offlineCompletions: Array<Record<string, unknown>>;
}> {
  const query: Record<string, string> = {};
  if (params?.year) query.year = params.year;
  if (params?.months?.length) query.months = params.months.join(',');
  if (params?.categoryCodes?.length) query.categoryCodes = params.categoryCodes.join(',');
  return request.get(`/biz/analysis/city/${encodeURIComponent(cityId)}`, { params: query }).then((r) => r.data);
}

/** 经营单位详情（快照口径）：与经营分析概览/单位对比/预警同一 ready 快照；无 ready 快照时 status='none'、summary=null、contracts=[] */
export function bizAnalysisCityDetailSnapshot(cityId: string): Promise<{
  snapshotId: string | null;
  asOf: string | null;
  status: string;
  city: { id: string; name: string; provinceId: string | null; provinceName: string; unitType: string };
  summary: { contractCount: number; contractAmountFen: number; orderCompletionFen: number; offlineCompletionFen: number; costFen: number; grossProfitFen: number; netProfitFen: number } | null;
  contracts: Array<Record<string, unknown>>;
  overruns: Array<Record<string, unknown>>;
}> {
  return request.get(`/biz/analysis/city/${encodeURIComponent(cityId)}/snapshot`).then((r) => r.data);
}

/** 批量合同完工进度（合同概览"完工进度"列用）：返回 { [contractId]: pct(两位小数数值) | null }；金额<=0 或缺失 → null */
export function bizContractsBatchProgress(ids: string[]): Promise<{ progress: Record<string, number | null> }> {
  if (!ids.length) return Promise.resolve({ progress: {} });
  return request.get('/biz/contracts/batch-progress', { params: { ids: ids.join(',') } }).then((r) => r.data);
}

// ================= 合同概览快照（一合同一行，服务端分页） =================

/** 合同台账快照行（与后端 biz_snapshot_contract_ledger 字段一一对应）；无 ready 快照时由实时回退填充，completionProgressPct 仍可用 */
export interface BizContractLedgerItem {
  id: string;
  contractId: string;
  contractNo: string | null;
  contractName: string | null;
  taxInclusiveAmountFen: number;
  provinceId: string | null;
  provinceName?: string | null;
  status: string | null;
  effectiveStatus?: string | null;
  statusAsOf?: string | null;
  signedDate: string | null;
  startDate: string | null;
  endDate: string | null;
  sourceUploadRecordId: string | null;
  cumulativeCompletionFen: number;
  completionProgressPct: number | null;
}

/** 合同概览（快照口径，一合同一行）：服务端分页 + 关键词/省份/地市/状态/日期筛选；无 ready 快照时实时回退 status='live' */
export function bizContractLedger(params?: {
  page?: number; pageSize?: number; keyword?: string; provinceId?: string; cityId?: string;
  status?: string; startDate?: string; endDate?: string;
}): Promise<{ items: BizContractLedgerItem[]; total: number; page: number; pageSize: number; snapshotMetadata: BizSnapshotMetadata }> {
  const query: Record<string, string> = {};
  if (params?.page != null) query.page = String(params.page);
  if (params?.pageSize != null) query.pageSize = String(params.pageSize);
  if (params?.keyword) query.keyword = params.keyword;
  if (params?.provinceId) query.provinceId = params.provinceId;
  if (params?.cityId) query.cityId = params.cityId;
  if (params?.status) query.status = params.status;
  if (params?.startDate) query.startDate = params.startDate;
  if (params?.endDate) query.endDate = params.endDate;
  return request.get('/biz/analysis/contracts', { params: query }).then((r) => r.data);
}

// ================= 枚举中文映射（统一：状态枚举 → 中文） =================

/** 合同状态中文：active 执行中 / draft 待生效 / completed 已完成 / voided 已作废 / cancelled 已取消 / expired 已到期 */
export const CONTRACT_STATUS_TEXT: Record<string, string> = {
  draft: '待生效', active: '执行中', expired: '已到期', completed: '已完成', voided: '已作废', cancelled: '已取消',
};
/** 合同状态 Tag 颜色（Ant Design Badge/Tag status 取值） */
export const CONTRACT_STATUS_COLOR: Record<string, string> = {
  draft: 'default', active: 'blue', expired: 'red', completed: 'green', voided: 'red', cancelled: 'default',
};

/**
 * 取一条记录的"有效展示状态"与其判断基准日（前端展示层统一入口）。
 * 优先用服务端下发的 effectiveStatus（唯一权威）；旧接口未下发时，
 * 仅在服务端同时给了 statusAsOf 时才本地回退计算；否则不基于客户端时钟推导到期，
 * 原样返回主状态，避免客户端时区覆盖快照 asOf。
 * 入参兼容具名合同类型（BizContractItem / BizContractLedgerItem / detail.contract）与通用 Record 行。
 */
export function effectiveContractStatus<T extends object>(rec: T): { status: string; statusAsOf: string | null } {
  const raw = (rec as { status?: string | null; endDate?: string | null; effectiveStatus?: string | null; statusAsOf?: string | null });
  const effective = raw.effectiveStatus;
  if (effective) return { status: effective, statusAsOf: raw.statusAsOf ?? null };
  if (raw.statusAsOf) {
    const computed = computeEffectiveContractStatus(raw.status, raw.endDate, raw.statusAsOf);
    return { status: computed ?? raw.status ?? '', statusAsOf: raw.statusAsOf };
  }
  // 旧数据且无 asOf：不臆断到期，直接返回主状态
  return { status: raw.status ?? '', statusAsOf: null };
}
/** 合同地市分配状态中文：active 生效中 / cancelled 已取消 */
export const ALLOCATION_STATUS_TEXT: Record<string, string> = {
  active: '生效中', cancelled: '已取消',
};

// ================= 经营分析快照（M6 统一 dashboard） =================

export interface BizSnapshotMetadata {
  snapshotId: string | null;
  asOf: string | null;
  /** 'ready' = 真实快照读取；'live' = 无 ready 快照，回退实时聚合；'none' = 从未生成 */
  status: 'ready' | 'live' | 'none' | string | null;
  generatedAt: string | null;
  lastSuccessfulAt: string | null;
  /** 当前可用快照的基准日（即页面正在展示的数据所属日期） */
  currentAsOf?: string | null;
  /** 最近一次生成任务（含 failed/building），供顶部状态栏区分状态 */
  lastRun?: BizSnapshotLastRun | null;
}

export interface BizSnapshotLastRun {
  runId: string;
  status: string;
  asOf: string;
  finishedAt: string | null;
  errorMessage: string | null;
  source: string | null;
}

export interface BizSnapshotRunStatus {
  runId: string;
  status: 'building' | 'ready' | 'failed' | string;
  asOf: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorMessage: string | null;
}

export interface BizDashboardResult {
  overview: {
    orderCompletionFen: number; offlineCompletionFen: number; grossProfitFen: number; costFen: number;
    netProfitFen: number; contractCount: number; totalContractAmountFen: number; totalCompletionFen: number; monthCount: number;
  };
  trend: { items: Array<Record<string, unknown>> };
  byCity: { items: Array<Record<string, unknown>> };
  contractAlerts: { items: Array<Record<string, unknown>> };
  overruns: { items: Array<Record<string, unknown>> };
  snapshotMetadata: BizSnapshotMetadata;
}

/** 统一 dashboard：优先读取 ready 快照并按当前用户数据范围过滤；无 ready 时回退实时聚合（status='live'） */
/** signal 用于取消已过期的 dashboard 请求（切换筛选时避免旧响应覆盖新结果） */
export function bizSnapshotDashboard(params?: { year?: string; months?: string[]; provinceIds?: string[]; cityIds?: string[]; signal?: AbortSignal }): Promise<BizDashboardResult> {
  const query: Record<string, string> = {};
  if (params?.year) query.year = params.year;
  if (params?.months?.length) query.months = params.months.join(',');
  if (params?.provinceIds?.length) query.provinceIds = params.provinceIds.join(',');
  if (params?.cityIds?.length) query.cityIds = params.cityIds.join(',');
  return request.get('/biz/analysis/dashboard', { params: query, signal: params?.signal }).then((r) => r.data);
}

/** 手动触发快照生成（幂等）：同一 asOf 已在构建中则直接返回已有 runId */
export function bizSnapshotBuild(asOf?: string): Promise<{ ok: boolean; runId: string; status: string; asOf: string }> {
  return request.post('/biz/analysis/snapshot/build', asOf ? { asOf } : {}).then((r) => r.data);
}

/** 查询快照生成任务状态（用于"更新数据"轮询） */
export function bizSnapshotStatus(runId?: string): Promise<{ ok: boolean; run: BizSnapshotRunStatus | null }> {
  return request.get('/biz/analysis/snapshot/status', { params: runId ? { runId } : {} }).then((r) => r.data);
}

/** 轻量快照元数据（顶部状态栏轮询用，不含分析数据） */
export function bizSnapshotMetadata(): Promise<BizSnapshotMetadata> {
  return request.get('/biz/analysis/snapshot/metadata').then((r) => r.data);
}

export function bizAggregateRecalc(scope: Record<string, unknown>, confirmAll = false): Promise<{ ok: boolean }> {
  return request.post('/biz/aggregates/recalc', { scope, confirmAll }).then((r) => r.data);
}

export function bizAggregateCheck(): Promise<{ ok: boolean; warnings: Array<Record<string, unknown>>; warningCount: number }> {
  return request.post('/biz/aggregates/check').then((r) => r.data);
}

export function bizSettingsList(): Promise<{ items: Array<{ key: string; value: string; description: string | null }> }> {
  return request.get('/biz/settings').then((r) => r.data);
}

export function bizSettingUpdate(key: string, value: string): Promise<{ ok: boolean }> {
  return request.put(`/biz/settings/${key}`, { value }).then((r) => r.data);
}

export function bizOperationLogs(params?: {
  page?: number; pageSize?: number; limit?: number; actionType?: string; targetType?: string; operatorUserId?: string;
  dateFrom?: string; dateTo?: string;
}): Promise<{ items: Array<Record<string, unknown>>; total: number; page: number; pageSize: number }> {
  return request.get('/biz/admin/operation-logs', { params }).then((r) => r.data);
}

// ================= 消息中心与公告 =================

export interface BizInboxItem {
  id: string;
  source: 'announcement' | 'system';
  messageType: string;
  title: string;
  content: string;
  linkUrl: string | null;
  status: 'unread' | 'read';
  createdAt: string;
}

export interface BizAnnouncementDto {
  title: string;
  content: string;
  linkUrl?: string | null;
  audienceType: 'all' | 'province' | 'city';
  provinceId?: string | null;
  cityId?: string | null;
  expiresAt?: string | null;
}

export function bizMessageList(): Promise<{ items: BizInboxItem[]; unreadCount: number }> {
  return request.get('/biz/messages').then((r) => r.data);
}

export function bizMessageMarkRead(id: string, source: 'announcement' | 'system'): Promise<{ ok: boolean }> {
  return request.post(`/biz/messages/${id}/read`, { source }).then((r) => r.data);
}

export function bizAnnouncementManageList(): Promise<{ items: Array<Record<string, unknown>> }> {
  return request.get('/biz/announcements/manage').then((r) => r.data);
}

export function bizAnnouncementCreate(dto: BizAnnouncementDto): Promise<Record<string, unknown>> {
  return request.post('/biz/announcements', dto).then((r) => r.data);
}

export function bizAnnouncementUpdate(id: string, dto: BizAnnouncementDto): Promise<Record<string, unknown>> {
  return request.patch(`/biz/announcements/${id}`, dto).then((r) => r.data);
}

export function bizAnnouncementPublish(id: string): Promise<Record<string, unknown>> {
  return request.post(`/biz/announcements/${id}/publish`).then((r) => r.data);
}

export function bizAnnouncementWithdraw(id: string): Promise<Record<string, unknown>> {
  return request.post(`/biz/announcements/${id}/withdraw`).then((r) => r.data);
}

// ================= 管理费率批量维护（合同管理 → 管理费率） =================

export type BizFeeRateMaintenanceStatus = 'pending' | 'maintained' | 'partial' | 'import_pending' | 'import_error';

export const FEE_RATE_MAINTENANCE_STATUS_TEXT: Record<string, string> = {
  pending: '待填写',
  maintained: '已维护',
  partial: '部分月份缺失',
  import_pending: '已导入待确认',
  import_error: '导入错误',
};

export interface BizFeeRateMaintenanceItem {
  contractId: string;
  contractNo: string;
  contractName: string;
  provinceId: string;
  provinceName: string;
  cityId: string;
  cityName: string;
  firstOrderMonth: string;
  lastOrderMonth: string;
  /** 缺失为 null，页面需显示"缺失"，不允许当成 0% */
  currentRateBp: number | null;
  missingMonths: string[];
  missingMonthCount: number;
  missingMonthsText: string;
  orderCount: number;
  orderAmountFen: number;
  status: BizFeeRateMaintenanceStatus;
  statusText: string;
  suggestedEffectiveMonth: string;
}

export interface BizFeeRateMaintenanceQuery {
  keyword?: string;
  provinceId?: string;
  cityId?: string;
  monthFrom?: string;
  monthTo?: string;
  status?: string;
  onlyMissing?: boolean;
  page?: number;
  pageSize?: number;
}

export function bizFeeRateMaintenance(params: BizFeeRateMaintenanceQuery): Promise<{ items: BizFeeRateMaintenanceItem[]; total: number }> {
  const query: Record<string, string> = {};
  if (params.keyword) query.keyword = params.keyword;
  if (params.provinceId) query.provinceId = params.provinceId;
  if (params.cityId) query.cityId = params.cityId;
  if (params.monthFrom) query.monthFrom = params.monthFrom;
  if (params.monthTo) query.monthTo = params.monthTo;
  if (params.status) query.status = params.status;
  if (params.onlyMissing) query.onlyMissing = 'true';
  query.page = String(params.page ?? 1);
  query.pageSize = String(params.pageSize ?? 20);
  return request.get('/biz/fee-rates/maintenance', { params: query }).then((r) => r.data);
}

export async function bizFeeRateMaintenanceExport(params: BizFeeRateMaintenanceQuery): Promise<Blob> {
  const query: Record<string, string> = {};
  if (params.keyword) query.keyword = params.keyword;
  if (params.provinceId) query.provinceId = params.provinceId;
  if (params.cityId) query.cityId = params.cityId;
  if (params.monthFrom) query.monthFrom = params.monthFrom;
  if (params.monthTo) query.monthTo = params.monthTo;
  if (params.status) query.status = params.status;
  if (params.onlyMissing) query.onlyMissing = 'true';
  const response = await request.get('/biz/fee-rates/maintenance/export', { params: query, responseType: 'blob' });
  return response.data as Blob;
}

export type BizFeeRateRowOutcome = 'new' | 'overwrite' | 'skip' | 'error';

export interface BizFeeRateImportPreviewRow {
  rowNo: number;
  contractId: string | null;
  contractNo: string;
  contractName: string;
  cityId: string | null;
  cityName: string;
  effectiveMonth: string | null;
  rateBp: number | null;
  changeReason: string | null;
  outcome: BizFeeRateRowOutcome;
  message: string | null;
  prevRateBp: number | null;
}

export interface BizFeeRateImportIssue {
  rowNo: number;
  contractNo: string;
  cityName: string;
  month: string;
  message: string;
}

export interface BizFeeRateImportPreview {
  taskId: string;
  fileName: string;
  fileHash: string;
  totalRows: number;
  newCount: number;
  overwriteCount: number;
  errorCount: number;
  skipCount: number;
  affectedOrderCount: number;
  affectedAmountFen: number;
  rows: BizFeeRateImportPreviewRow[];
  errors: BizFeeRateImportIssue[];
  warnings: BizFeeRateImportIssue[];
}

export async function bizFeeRateImportPreview(file: File): Promise<BizFeeRateImportPreview> {
  const form = new FormData();
  form.append('file', file);
  const response = await request.post('/biz/fee-rates/import/preview', form, { headers: { 'Content-Type': 'multipart/form-data' } });
  return response.data as BizFeeRateImportPreview;
}

export interface BizFeeRateImportConfirmResult {
  taskId: string;
  status: string;
  savedCount: number;
  recalcOrderCount: number;
  successCount: number;
  skipCount: number;
  failedCount: number;
  affectedOrderCount: number;
  affectedAmountFen: number;
  failureReasons: string[];
}

export function bizFeeRateImportConfirm(taskId: string): Promise<BizFeeRateImportConfirmResult> {
  return request.post('/biz/fee-rates/import/confirm', { taskId }).then((r) => r.data);
}

export interface BizFeeRateImportTask {
  id: string;
  operatorUserId: string;
  fileName: string;
  fileHash: string;
  status: string;
  totalRows: number;
  newCount: number;
  overwriteCount: number;
  errorCount: number;
  skipCount: number;
  affectedOrderCount: number;
  affectedAmountFen: number;
  recalculated: boolean;
  errorSummary: string | null;
  createdAt: string;
  confirmedAt: string | null;
  finishedAt: string | null;
}

export const FEE_RATE_IMPORT_STATUS_TEXT: Record<string, string> = {
  queued: '排队中',
  processing: '处理中',
  completed: '已完成',
  partial_failed: '部分失败',
  failed: '失败',
};

export function bizFeeRateImportTask(taskId: string): Promise<BizFeeRateImportTask> {
  return request.get(`/biz/fee-rates/import/${taskId}`).then((r) => r.data);
}

export interface BizFeeRateImportTaskRow {
  id: string;
  taskId: string;
  rowNo: number;
  contractId: string | null;
  cityId: string | null;
  effectiveMonth: string | null;
  rateBp: number | null;
  prevRateBp: number | null;
  changeReason: string | null;
  outcome: BizFeeRateRowOutcome;
  message: string | null;
}

export function bizFeeRateImportTaskErrors(taskId: string): Promise<{ items: BizFeeRateImportTaskRow[] }> {
  return request.get(`/biz/fee-rates/import/${taskId}/errors`).then((r) => r.data);
}

export interface BizFeeRateBatchResult {
  savedCount: number;
  newCount: number;
  overwriteCount: number;
  skipCount: number;
  failedCount: number;
  recalcOrderCount: number;
  affectedOrderCount: number;
  affectedAmountFen: number;
  failureReasons: string[];
}

export function bizFeeRateCopy(dto: { sourceMonth: string; targetMonth: string; contractIds: string[]; cityIds?: string[]; overwrite?: boolean }): Promise<BizFeeRateBatchResult> {
  return request.post('/biz/fee-rates/copy', dto).then((r) => r.data);
}

export function bizFeeRateBulkApply(dto: { contractIds: string[]; cityIds: string[]; effectiveMonth: string; rateBp: number; changeReason?: string; overwrite?: boolean }): Promise<BizFeeRateBatchResult> {
  return request.post('/biz/fee-rates/bulk-apply', dto).then((r) => r.data);
}
