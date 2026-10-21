import axios from 'axios';
import { getBizToken } from '@/utils/biz-auth';

const request = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '/api' });
request.interceptors.request.use((config) => { const token = getBizToken(); if (token) config.headers.Authorization = `Bearer ${token}`; return config; });

export type MaintenanceItem = Record<string, unknown> & { id: string; status: string; orgProvince: string; orgCity?: string | null; orgCompany: string; orgRegion: string };
export type MaintenanceQuery = { keyword?: string; orgProvince?: string; orgCity?: string; orgCompany?: string; orgRegion?: string; status?: string; page?: number; pageSize?: number };
export async function maintenanceList(kind: 'personnel'|'vehicles'|'generators', params: MaintenanceQuery) { return (await request.get(`/biz/maintenance/${kind}`, { params })).data as { items: MaintenanceItem[]; total: number; page: number; pageSize: number }; }
export async function maintenanceCreate(kind: 'personnel'|'vehicles'|'generators', data: Record<string, unknown>) { return (await request.post(`/biz/maintenance/${kind}`, data)).data as MaintenanceItem; }
export async function maintenanceUpdate(kind: 'personnel'|'vehicles'|'generators', id: string, data: Record<string, unknown>) { return (await request.patch(`/biz/maintenance/${kind}/${id}`, data)).data as MaintenanceItem; }
export async function maintenanceRemove(kind: 'personnel'|'vehicles'|'generators', id: string) { return (await request.delete(`/biz/maintenance/${kind}/${id}`)).data as { id: string; deleted: boolean }; }
/** 数据总览：三类资产计数 + 到期清单 + 组织汇总，一次请求返回（替代原先的逐页翻表） */
export type MaintenanceReminder = { id: string; kind: 'personnel'|'vehicles'|'generators'; category: string; recordId: string; name: string; region: string; title: string; date: string; days: number | null; invalidDate: boolean };
export type MaintenanceOverview = {
  today: string;
  generatedAt: string;
  windowDays: number;
  counts: { personnel: number; vehicles: number; generators: number; expired: number; dueSoon: number; pending: number; anomaly: number };
  byKind: Array<{ kind: 'personnel'|'vehicles'|'generators'; category: string; expired: number; dueSoon: number; anomaly: number; total: number }>;
  reminders: MaintenanceReminder[];
  organizations: Array<{ region: string; personnel: number; vehicles: number; generators: number }>;
};
export async function maintenanceOverview(windowDays = 30): Promise<MaintenanceOverview> {
  return (await request.get('/biz/maintenance/overview', { params: { windowDays } })).data as MaintenanceOverview;
}
/** 筛选项字典（服务端 distinct）：区县/地市/公司下拉不再取自「当前页 50 条」 */
export type MaintenanceFacets = { provinces: string[]; cities: string[]; companies: string[]; regions: string[] };
/** 级联：传 orgProvince / orgCity 时，regions 只返回该范围内的区县 */
export async function maintenanceFacets(
  kind: 'personnel'|'vehicles'|'generators',
  params: { orgProvince?: string; orgCity?: string } = {},
): Promise<MaintenanceFacets> {
  return (await request.get(`/biz/maintenance/${kind}/facets`, { params })).data as MaintenanceFacets;
}
export type MaintenanceDocument = { id: string; category: string; fileName: string; mimeType: string; fileSize: number; createdAt?: string };
export type MaintenanceDocumentUpload = MaintenanceDocument & { extractedText: string; fields: Array<{ key: string; text: string }>; ocrAvailable: boolean; extractionError?: string | null };
export async function maintenanceUploadDocument(kind: 'personnel'|'vehicles'|'generators', category: string, file: File): Promise<MaintenanceDocumentUpload> {
  const form = new FormData(); form.append('file', file);
  return (await request.post(`/biz/maintenance/${kind}/documents/upload?category=${encodeURIComponent(category)}`, form, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 90_000 })).data;
}
export async function maintenanceListDocuments(kind: 'personnel'|'vehicles'|'generators', id: string): Promise<MaintenanceDocument[]> {
  return (await request.get(`/biz/maintenance/${kind}/${encodeURIComponent(id)}/documents`)).data as MaintenanceDocument[];
}
export async function maintenanceDownloadDocument(kind: 'personnel'|'vehicles'|'generators', id: string): Promise<Blob> {
  return (await request.get(`/biz/maintenance/${kind}/documents/${encodeURIComponent(id)}/download`, { responseType: 'blob' })).data as Blob;
}
