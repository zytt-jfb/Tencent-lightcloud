/**
 * Dashboard API for Admin Web.
 */
import type {
  AdminBusinessSummaryResponse,
  DashboardStats,
} from '@biz-reporting/shared-types';
import request from '@/utils/request';

const BASE = '/admin/dashboard';

export function getDashboard(year?: number, month?: number): Promise<DashboardStats> {
  return request.get(BASE, { params: { year, month } });
}

export function getBusinessSummary(year: number): Promise<AdminBusinessSummaryResponse> {
  return request.get(`${BASE}/business-summary`, {
    params: { year },
  });
}
