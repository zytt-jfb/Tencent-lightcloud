import request, { getBlob, postForm } from '@/utils/request';

export type AiTool = 'business_summary' | 'import_anomalies';

/** 历史接口：白名单只读工具（仅超管），保留不动 */
export function queryAiTool(tool: AiTool, year: number, cityId?: number | null): Promise<Record<string, unknown>> {
  return request.post('/admin/ai/query', { tool, year, cityId: cityId ?? null });
}

// ============================================================================
// 内部 AI 助手（规则主路：意图匹配 → 预置 SQL → 图表 + 文字）
// ============================================================================

export type AiCategory = 'rank' | 'summary' | 'compare' | 'report' | 'qa';

export interface AiColumn {
  key: string;
  label: string;
  kind?: 'text' | 'number' | 'money' | 'percent' | 'date';
}

export interface AiChatMeta {
  traceId: string;
  eventId: number | null;
  rowCount: number;
  latencyMs: number;
  truncated: boolean;
  intentSource: 'rule' | 'qa' | 'guide';
  scopeLabel: string;
  llmEnabled: boolean;
}

export interface AiIntentItem {
  id: string;
  name: string;
  category: AiCategory;
  examples: string[];
}

export interface AiChunk {
  sourcePath: string;
  title: string | null;
  section: string | null;
  excerpt: string;
}

export interface AiChatResponse {
  type: 'answer' | 'guide' | 'ask_param' | 'knowledge';
  intentId?: string | null;
  intentName?: string | null;
  category?: AiCategory | null;
  summary: string;
  /** ECharts option（后端生成，前端直接渲染） */
  chart?: Record<string, unknown> | null;
  columns?: AiColumn[];
  rows?: Array<Record<string, unknown>>;
  chunks?: AiChunk[];
  guide?: AiIntentItem[];
  missing?: Array<{ name: string; label: string }>;
  meta: AiChatMeta;
}

/**
 * 提问。
 * 单独放宽 timeout 到 30s：正常查询是百毫秒级，但并发排队 + 首次建立只读连接
 * 可能占用几秒，用默认 15s 容易在前几个人同时问的时候误报超时。
 */
export function aiChat(question: string): Promise<AiChatResponse> {
  return request.post('/biz/ai/chat', { question }, { timeout: 30_000 });
}

/** 按意图生成报告（功能清单点选） */
export function aiReport(intentId: string, params?: Record<string, string | number>): Promise<AiChatResponse> {
  return request.post('/biz/ai/report', { intentId, params }, { timeout: 30_000 });
}

/** 当前账号可用的功能清单（后端已按权限过滤） */
export function aiIntents(): Promise<{ items: AiIntentItem[]; rejected: Array<{ id: string; reason: string }> }> {
  return request.get('/biz/ai/intents');
}

/** 结果反馈：写进数据飞轮，作为以后的语料 */
export function aiFeedback(eventId: number, feedback: 'up' | 'down', note?: string): Promise<{ ok: boolean }> {
  return request.post('/biz/ai/feedback', { eventId, feedback, note });
}

/** 组件自检（仅超管） */
export function aiStatus(): Promise<Record<string, unknown>> {
  return request.get('/biz/ai/status');
}

// ============================================================================
// 批量导入（AI 助手统一入口）
// 真正落库仍由各模块自己的接口完成，这里只做「清单 + 上传」两件事
// ============================================================================

export interface AiImportType {
  key: string;
  name: string;
  group: string;
  /** direct=选完文件提交即完成；preview-commit=先预检看统计，确认后再提交 */
  mode: 'direct' | 'preview-commit';
  endpoint?: string;
  previewEndpoint?: string;
  commitEndpoint?: string;
  templateEndpoint?: string;
  accept?: string;
  hint?: string;
}

export interface AiImportPreviewShape {
  kind?: string;
  label?: string;
  totalRows?: number;
  createCount?: number;
  updateCount?: number;
  reviveCount?: number;
  errorCount?: number;
  ignoredColumns?: string[];
  matchedColumns?: Array<{ column: string; field: string; label: string }>;
  missingRequiredColumns?: string[];
  issues?: Array<{ rowNo: number; message: string }>;
  created?: number;
  updated?: number;
  revived?: number;
  /** 本次导入批次号（同时写进审计日志） */
  batchId?: string;
}

/** 当前账号可用的导入类型（后端已按双闸过滤，无权的不会返回） */
export function aiImportTypes(): Promise<{ items: AiImportType[] }> {
  return request.get('/biz/ai/import-types');
}

/** 统一上传：目标地址来自清单，既有模块接口与新维护导入接口共用这一个封装 */
export function aiImportUpload(url: string, file: File): Promise<Record<string, unknown>> {
  const form = new FormData();
  form.append('file', file);
  return postForm<Record<string, unknown>>(url, form);
}

/** 下载导入模板（要带 token，走 blob 而不是直接 window.open） */
export function aiImportTemplate(url: string): Promise<Blob> {
  return getBlob(url);
}
