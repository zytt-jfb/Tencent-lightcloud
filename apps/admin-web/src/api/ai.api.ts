import request from '@/utils/request';

export type AiTool = 'business_summary' | 'import_anomalies';

export function queryAiTool(tool: AiTool, year: number, cityId?: number | null): Promise<Record<string, unknown>> {
  return request.post('/admin/ai/query', { tool, year, cityId: cityId ?? null });
}
