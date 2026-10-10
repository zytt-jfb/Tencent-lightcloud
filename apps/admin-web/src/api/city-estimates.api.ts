import request from '@/utils/request';

export interface CityOption {
  id: number;
  name: string;
}

export interface CityMonthContractRow {
  contractId: number | null;
  contractCode: string;
  contractName: string;
  completionAmount: number;
  acceptanceAmount: number;
  invoiceAmount: number | null;
  orderAmount: number | null;
}

export interface CityMonthCostRow {
  costCategoryCode: string;
  amount: number;
}

export interface CityMonthMaintenanceRow {
  invoiceTotalPrevYear: number;
  invoiceMonthCountPrevYear: number;
  invoiceTotalCurrentYear: number;
}

export interface CityMonthData {
  packageId: number;
  cityId: number;
  reportYear: number;
  status: string;
  monthNo: number;
  isSubmitted: boolean;
  contractRows: CityMonthContractRow[];
  costRows: CityMonthCostRow[];
  maintenanceRow: CityMonthMaintenanceRow | null;
}

export function listCities(): Promise<CityOption[]> {
  return request.get('/cities');
}

export function getCityMonthData(packageId: number, monthNo: number): Promise<CityMonthData> {
  return request.get(`/city/packages/${packageId}/months/${monthNo}`);
}
 
export interface AdminContractCity {
  cityId: number;
  cityName: string;
}

export interface AdminContractListItem {
  id: number;
  cities: AdminContractCity[];
}

export interface AdminContractListResponse {
  items: AdminContractListItem[];
}

export function listAdminContracts(): Promise<AdminContractListResponse> {
  return request.get('/admin/contracts', { params: { page: 1, pageSize: 1000 } });
}