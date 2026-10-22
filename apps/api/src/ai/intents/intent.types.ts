/**
 * 意图（Intent）类型定义
 *
 * 设计原则：意图 = 一份「人工预置的查询契约」，不是让模型自由发挥。
 *   SQL 是写死的模板，文字是写死的模板 + 真实结果填充，
 *   所以这个结构里没有任何「让 LLM 生成」的字段 —— 这就是「零幻觉」的来源。
 */

export type IntentCategory = 'rank' | 'summary' | 'compare' | 'report' | 'qa';

/** 图表描述：只声明「用哪些字段画什么图」，ECharts option 由 report 层统一生成 */
export interface IntentChartSpec {
  type: 'bar' | 'line' | 'pie';
  /** X 轴字段（pie 图不用） */
  xField?: string;
  /** 系列字段（pie 图只用第一个） */
  yFields: string[];
  /** pie 图的分类字段 */
  nameField?: string;
  title: string;
  /** 数值单位，仅用于轴标签/提示，例如「分」「元」 */
  unit?: string;
}

/** SQL 模板声明 */
export interface IntentSqlSpec {
  /**
   * 参数化 SQL。约定（启动期强制校验，违反直接启动失败）：
   *   1. 必须以 SELECT / WITH 开头；
   *   2. 必须含 `{{scope}}` 占位，且位置必须早于第一个 `?`
   *      —— 这样参数顺序恒为 [scope 参数..., 意图参数...]，不需要动态拼接位置；
   *   3. 必须写死 LIMIT 字面量（不允许 LIMIT ?）；
   *   4. 只能引用白名单表。
   */
  text: string;
  /** scope 谓词注入的列名，可为 `a.city_id` 这种带别名的形式 */
  scopeColumn: string;
  /**
   * scope 取值类型：
   *   city_id   —— 表里存地市 UUID（后评估/成本/合同分配）
   *   city_name —— 表里存地名（biz_performance_record.city 是 varchar 地名）
   */
  scopeValueType: 'city_id' | 'city_name';
}

/** 参数声明：只做「轻量抽取 + 合法性校验」，不做 NLP */
export interface IntentParamSpec {
  /** 从内置值列表匹配（例如地市名字典） */
  from?: 'city_dictionary' | 'month' | 'year' | 'month_range' | 'days';
  /** 正则抽取（命名组或第一个捕获组） */
  pattern?: RegExp;
  required?: boolean;
  /** 缺省值策略：由 AiService 解析，不允许前端传入 */
  defaultValue?: { kind: 'latest_eval_month' } | { kind: 'current_year' } | { kind: 'ytd_months' } | { kind: 'next_days'; days: number };
  label?: string;
}

export interface IntentColumnSpec {
  key: string;
  label: string;
  kind?: 'text' | 'number' | 'money' | 'percent' | 'date';
}

export interface Intent {
  id: string;
  name: string;
  category: IntentCategory;
  /** 触发词（含同义词）。命中任一即进入候选，最终按打分取最高 */
  triggers: string[];
  /** 全局归一映射：口语 → 标准词（如 座次/排行 → 排名）。key 长度优先替换，避免子串互相覆盖 */
  synonyms?: Record<string, string>;
  params: Record<string, IntentParamSpec>;
  /** 需要的权限点；不填表示「登录即可」。无权限的意图不会出现在引导清单里 */
  auth?: string;
  /** RAG 问答类意图没有 SQL */
  sql?: IntentSqlSpec;
  chart?: IntentChartSpec;
  /** 文字模板；占位符 `{字段名}` 只能引用结果字段或已解析参数，缺失时输出「—」而不是编造 */
  summary: string;
  /** 越大越优先，用于「排名」与「排名环比」这类重叠触发词 */
  priority?: number;
  examples?: string[];
  columns?: IntentColumnSpec[];
  /** 结果为空时的固定话术（仍来自模板，不是生成） */
  emptyHint?: string;
}

/** 命中结果 */
export interface IntentMatch {
  intent: Intent;
  /** 命中的触发词（审计用：能看出为什么匹配到它） */
  matchedTriggers: string[];
  /** 归一化后的输入 */
  normalized: string;
}

/** 参数抽取结果 */
export type IntentParams = Record<string, string | number | null>;

export interface GuideItem {
  id: string;
  name: string;
  category: IntentCategory;
  examples: string[];
}
