import axios from 'axios';
import { getBizToken } from '@/utils/biz-auth';

const request = axios.create({ baseURL: import.meta.env.VITE_API_BASE_URL || '/api' });
request.interceptors.request.use((config) => { const token = getBizToken(); if (token) config.headers.Authorization = `Bearer ${token}`; return config; });

export type MaintenanceItem = Record<string, unknown> & { id: string; status: string; orgProvince: string; orgCompany: string; orgRegion: string };
export type MaintenanceQuery = { keyword?: string; orgProvince?: string; orgCompany?: string; orgRegion?: string; status?: string; page?: number; pageSize?: number };
export async function maintenanceList(kind: 'personnel'|'vehicles'|'generators', params: MaintenanceQuery) { return (await request.get(`/biz/maintenance/${kind}`, { params })).data as { items: MaintenanceItem[]; total: number; page: number; pageSize: number }; }
export async function maintenanceCreate(kind: 'personnel'|'vehicles'|'generators', data: Record<string, unknown>) { return (await request.post(`/biz/maintenance/${kind}`, data)).data as MaintenanceItem; }
export async function maintenanceUpdate(kind: 'personnel'|'vehicles'|'generators', id: string, data: Record<string, unknown>) { return (await request.patch(`/biz/maintenance/${kind}/${id}`, data)).data as MaintenanceItem; }
export async function maintenanceRemove(kind: 'personnel'|'vehicles'|'generators', id: string) { return (await request.delete(`/biz/maintenance/${kind}/${id}`)).data as { id: string; deleted: boolean }; }
