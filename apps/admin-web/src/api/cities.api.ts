import request from '@/utils/request';

export interface AdminCityItem {
  id: number;
  name: string;
  code: string | null;
  sortOrder: number;
  isDeleted: boolean;
  deletedAt: string | null;
}

export interface PublicCityOption {
  id: number;
  name: string;
}

export function listPublicCities(): Promise<PublicCityOption[]> {
  return request.get('/cities');
}
export interface CityInput {
  name: string;
  code?: string | null;
  sortOrder?: number;
}

export function listAdminCities(): Promise<AdminCityItem[]> {
  return request.get('/admin/cities');
}

export function createCity(input: CityInput): Promise<AdminCityItem> {
  return request.post('/admin/cities', input);
}

export function updateCity(cityId: number, input: Partial<CityInput>): Promise<AdminCityItem> {
  return request.patch(`/admin/cities/${cityId}`, input);
}

export function softDeleteCity(cityId: number): Promise<{ success: boolean; city: AdminCityItem }> {
  return request.delete(`/admin/cities/${cityId}`);
}
