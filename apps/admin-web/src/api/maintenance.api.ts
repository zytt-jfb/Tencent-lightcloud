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
