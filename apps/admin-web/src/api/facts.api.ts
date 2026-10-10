import type {
  ContractProgressFactItem, CostFactItem, CreateCostFactRequest, CreateOrderFactRequest, FactAggregateResponse, FactImportResult,
  FactListQuery, FactPage, FactVersionItem, FactVersionQuery, LocalContractItem, OrderFactItem, ReverseFactRequest,
  UpdateCostFactRequest, UpdateOrderFactRequest,
} from '@biz-reporting/shared-types';
import request, { postForm, type RequestOptions } from '@/utils/request';

const conflictAwareRequest: RequestOptions = { suppressErrorToast: true };

function params(query: FactListQuery | FactVersionQuery) {
  return { params: { ...query, cityIds: query.cityIds?.join(',') } };
}

export const factsApi = {
  listCosts: (query: FactListQuery) => request.get('/city/facts/costs', params(query)) as Promise<FactPage<CostFactItem>>,
  createCost: (data: CreateCostFactRequest) => request.post('/city/facts/costs', data) as Promise<CostFactItem>,
  updateCost: (id: number, data: UpdateCostFactRequest) => request.patch(`/city/facts/costs/${id}`, data, conflictAwareRequest) as Promise<CostFactItem>,
  reverseCost: (id: number, data: ReverseFactRequest) => request.post(`/city/facts/costs/${id}/reverse`, data, conflictAwareRequest) as Promise<CostFactItem>,
  importCosts: (file: File, templateType: string, contractCode?: string) => {
    const form = new FormData(); form.append('file', file); form.append('templateType', templateType);
    if (contractCode) form.append('contractCode', contractCode);
    return postForm<FactImportResult>('/city/facts/costs/import', form);
  },
  listOrders: (query: FactListQuery) => request.get('/city/facts/orders', params(query)) as Promise<FactPage<OrderFactItem>>,
  createOrder: (data: CreateOrderFactRequest) => request.post('/city/facts/orders', data) as Promise<OrderFactItem>,
  updateOrder: (id: number, data: UpdateOrderFactRequest) => request.patch(`/city/facts/orders/${id}`, data, conflictAwareRequest) as Promise<OrderFactItem>,
  reverseOrder: (id: number, data: ReverseFactRequest) => request.post(`/city/facts/orders/${id}/reverse`, data, conflictAwareRequest) as Promise<OrderFactItem>,
  importOrders: (file: File) => { const form = new FormData(); form.append('file', file); return postForm<FactImportResult>('/city/facts/orders/import', form); },
  localContracts: (query: FactListQuery) => request.get('/city/facts/contracts', params(query)) as Promise<LocalContractItem[]>,
  citySummary: (query: FactListQuery) => request.get('/city/facts/summary', params(query)) as Promise<FactAggregateResponse>,
  cityVersions: (query: FactVersionQuery) => request.get('/city/facts/versions', params(query)) as Promise<FactPage<FactVersionItem>>,
  cityVersion: (id: number) => request.get(`/city/facts/versions/${id}`) as Promise<FactVersionItem>,
  adminSummary: (query: FactListQuery) => request.get('/admin/facts/summary', params(query)) as Promise<FactAggregateResponse>,
  adminProgress: (query: FactListQuery) => request.get('/admin/facts/progress', params(query)) as Promise<ContractProgressFactItem[]>,
  adminCosts: (query: FactListQuery) => request.get('/admin/facts/costs', params(query)) as Promise<FactPage<CostFactItem>>,
  adminOrders: (query: FactListQuery) => request.get('/admin/facts/orders', params(query)) as Promise<FactPage<OrderFactItem>>,
  adminVersions: (query: FactVersionQuery) => request.get('/admin/facts/versions', params(query)) as Promise<FactPage<FactVersionItem>>,
  adminVersion: (id: number) => request.get(`/admin/facts/versions/${id}`) as Promise<FactVersionItem>,
};
