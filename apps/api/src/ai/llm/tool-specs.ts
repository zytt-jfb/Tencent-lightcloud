import { INTENT_CATALOG } from '../intents/catalog';
import type { Intent } from '../intents/intent.types';
import type { RouterToolSpec } from './prompts/router.prompt';

/**
 * 注入给路由器的工具清单（**派生**，不再手写）
 *
 * 改造前这里是第二份手写清单（id + 描述 + 参数），与 catalog.ts 各维护一半：
 * 新增意图忘了同步，就会出现「规则能命中但模型永远选不到」这种只在线上暴露的问题。
 *
 * 现在描述只有一处来源：
 *   · 「能回答什么问题」→ `intent.route.desc`（人工写，因为 summary 是带占位符的结论模板，不能复用）
 *   · 「参数怎么填」    → `intent.params`（确定性派生，见 deriveParamsText）
 */

/** 参数值 → 给人看的名字；没有 labels 时退回原值 */
function labelOf(intent: Intent, name: string, value: string): string {
  const labels = intent.params[name]?.enum?.labels;
  return labels?.[value] ?? value;
}

/**
 * 从 params 声明派生参数说明。
 * 输出格式与原来的手写版保持一致（`month（YYYY-MM）`、`kind（personnel=人员 / …）`），
 * 这样提示词里的示例不用跟着改。
 */
export function deriveParamsText(intent: Intent): string {
  const parts: string[] = [];
  for (const [name, spec] of Object.entries(intent.params)) {
    if (spec.enum) {
      const values = spec.enum.values
        .map((value) => {
          const label = labelOf(intent, name, value);
          return label === value ? value : `${value}=${label}`;
        })
        .join(' / ');
      parts.push(`${name}（${values}）`);
      continue;
    }
    if (spec.from === 'month_range') {
      parts.push(`${name}From、${name}To（YYYY-MM）`);
      continue;
    }
    if (spec.from === 'month') {
      parts.push(`${name}（YYYY-MM）`);
      continue;
    }
    if (spec.from === 'year') {
      parts.push(`${name}（整数）`);
      continue;
    }
    if (spec.from === 'days') {
      parts.push(`${name}（整数天数）`);
      continue;
    }
    if (spec.from === 'city_dictionary') {
      parts.push(`${name}（地市名）`);
      continue;
    }
    parts.push(name);
  }
  return parts.join('、');
}

/** 上架的路由工具：route.desc 有值才算（route: null 表示明确不上架） */
export const ROUTER_TOOL_SPECS: readonly RouterToolSpec[] = INTENT_CATALOG
  .filter((intent): intent is Intent & { route: { desc: string } } => Boolean(intent.route?.desc))
  .map((intent) => ({
    id: intent.id,
    desc: intent.route.desc,
    params: deriveParamsText(intent),
  }));
