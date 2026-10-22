import { Injectable } from '@nestjs/common';
import type { Intent, IntentColumnSpec, IntentParams } from '../intents/intent.types';

/** ECharts option 的最小结构（不引 echarts 依赖到后端，只产出普通对象让前端直接吃） */
export type EChartsOption = Record<string, unknown>;

export interface ReportTable {
  columns: IntentColumnSpec[];
  rows: Array<Record<string, unknown>>;
}

export interface BuiltReport {
  chart: EChartsOption | null;
  table: ReportTable;
  summary: string;
}

/**
 * 结果 → 图表 + 文字
 *
 * 两条硬规则：
 *   1. 文字只由模板 + 真实结果拼出来，没有任何生成式改写 —— 所以不会出现「图上是 82 分、文字说 85 分」。
 *   2. 模板里的占位符取不到值时输出「—」，绝不猜一个数字填进去。
 */
@Injectable()
export class ReportService {
  build(intent: Intent, rows: Array<Record<string, unknown>>, params: IntentParams): BuiltReport {
    const normalized = rows.map((row) => normalizeRow(row));
    return {
      chart: this.buildChart(intent, normalized),
      table: {
        columns: intent.columns ?? inferColumns(normalized),
        rows: normalized,
      },
      summary: renderTemplate(intent.summary, normalized, params),
    };
  }

  /** 空结果的提示文案也走模板（例如「{month} 没有查到数据」），保持一致口径 */
  emptySummary(intent: Intent, params: IntentParams): string {
    if (intent.emptyHint) return renderTemplate(intent.emptyHint, [], params);
    return '没有查到符合条件的数据。';
  }

  private buildChart(intent: Intent, rows: Array<Record<string, unknown>>): EChartsOption | null {
    const spec = intent.chart;
    if (!spec || rows.length === 0) return null;

    if (spec.type === 'pie') {
      const nameField = spec.nameField ?? spec.xField ?? '';
      const valueField = spec.yFields[0];
      return {
        tooltip: { trigger: 'item' },
        legend: { type: 'scroll', bottom: 0 },
        series: [
          {
            type: 'pie',
            radius: '62%',
            center: ['50%', '46%'],
            avoidLabelOverlap: true,
            label: { formatter: '{b}: {c}' },
            data: rows.map((row) => ({
              name: String(row[nameField] ?? '—'),
              value: toNumber(row[valueField]),
            })),
          },
        ],
        title: { text: spec.title, left: 'center', textStyle: { fontSize: 14, fontWeight: 'normal' } },
      };
    }

    const xField = spec.xField ?? '';
    return {
      tooltip: { trigger: 'axis' },
      legend: spec.yFields.length > 1 ? { bottom: 0 } : undefined,
      grid: { left: 48, right: 24, top: 48, bottom: spec.yFields.length > 1 ? 48 : 32 },
      xAxis: { type: 'category', data: rows.map((row) => String(row[xField] ?? '—')), axisLabel: { rotate: rows.length > 8 ? 30 : 0 } },
      yAxis: { type: 'value', name: spec.unit ?? '' },
      series: spec.yFields.map((field) => ({
        type: spec.type,
        name: field,
        smooth: spec.type === 'line',
        data: rows.map((row) => toNumber(row[field])),
      })),
      title: { text: spec.title, left: 'center', textStyle: { fontSize: 14, fontWeight: 'normal' } },
    };
  }
}

/**
 * 把 DECIMAL/BIGINT 的字符串值转成数字。
 * mysql2 为了精度把 DECIMAL 返回成字符串，ECharts 拿到字符串画不出图。
 * 只在「安全整数或常见小数」范围内转，超出范围（例如 18 位雪花 id）保留原字符串。
 */
function normalizeRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'string' && value !== '' && /^-?\d+(\.\d+)?$/.test(value)) {
      const asNumber = Number(value);
      const isSafeInteger = Number.isSafeInteger(asNumber) && Math.abs(asNumber) <= Number.MAX_SAFE_INTEGER;
      const isDecimal = !Number.isInteger(asNumber) && Math.abs(asNumber) < 1e15;
      out[key] = isSafeInteger || isDecimal ? asNumber : value;
      continue;
    }
    out[key] = value;
  }
  return out;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function inferColumns(rows: Array<Record<string, unknown>>): IntentColumnSpec[] {
  const first = rows[0];
  if (!first) return [];
  return Object.keys(first).map((key) => ({
    key,
    label: key,
    kind: typeof first[key] === 'number' ? 'number' : 'text',
  }));
}

/**
 * 模板渲染。支持的占位符：
 *   {rowCount}          结果行数
 *   {month}/{year}/...  已解析的参数
 *   {字段}              第一行的该字段
 *   {top1.字段}         第一行（SQL 已按目标顺序排好）
 *   {top2.字段}         第二行
 *   {last.字段}         最后一行
 *   {sum_字段}          该字段所有行求和（金额汇总用）
 * 取不到 → 「—」。这一条是「不编造」的最后一道保险。
 */
export function renderTemplate(
  template: string,
  rows: Array<Record<string, unknown>>,
  params: IntentParams,
  rowCountOverride?: number,
): string {
  return template.replace(/\{([a-zA-Z0-9_.]+)\}/g, (_match, rawKey: string) => {
    const key = rawKey;
    if (key === 'rowCount') return String(rowCountOverride ?? rows.length);
    if (Object.prototype.hasOwnProperty.call(params, key)) {
      const value = params[key];
      return value === null || value === undefined || value === '' ? '—' : formatValue(value);
    }
    if (key.startsWith('sum_')) {
      const field = key.slice('sum_'.length);
      const total = rows.reduce((sum, row) => sum + toNumber(row[field]), 0);
      return formatValue(total);
    }
    if (key.startsWith('top1.')) return formatValue(pickField(rows[0], key.slice(5)));
    if (key.startsWith('top2.')) return formatValue(pickField(rows[1], key.slice(5)));
    if (key.startsWith('last.')) return formatValue(pickField(rows[rows.length - 1], key.slice(5)));
    return formatValue(pickField(rows[0], key));
  });
}

function pickField(row: Record<string, unknown> | undefined, field: string): unknown {
  if (!row) return undefined;
  return row[field];
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '—';
    // 金额类数值保留两位并加千分位；分数类两位小数不加千分位（都是两位数，加了也不影响）
    return Math.abs(value) >= 1000
      ? value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : String(Number(value.toFixed(2)));
  }
  return String(value);
}
