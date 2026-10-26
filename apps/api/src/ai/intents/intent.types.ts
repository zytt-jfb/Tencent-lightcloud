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
  /**
   * 枚举参数：值只能取 values 之一。
   * aliases 用来把问句里的中文说法映射到值（如「车辆/车牌/交强险」→ vehicles），
   * 键是别名，值是 values 中的某一项。
   */
  enum?: {
    values: readonly string[];
    aliases?: Readonly<Record<string, string>>;
    /** 值 → 展示名，用于派生给模型看的参数说明（如 personnel → 人员） */
    labels?: Readonly<Record<string, string>>;
    defaultValue?: string;
  };
  /** 缺省值策略：由 AiService 解析，不允许前端传入 */
  defaultValue?: { kind: 'latest_eval_month' } | { kind: 'current_year' } | { kind: 'ytd_months' } | { kind: 'next_days'; days: number };
  label?: string;
}

/**
 * 代码处理器：不走 SQL 模板，直接调用业务服务
 *
 * 什么时候需要它：数据是 VARCHAR 文本、判定必须走应用层（例如证照有效期，「无」「2027-14-01」
 * 这类脏值在 SQL 里字符串比较会被当成零日期、算成已过期）；或者口径已经存在于业务服务里、
 * 重写一套必然与页面数字打架。
 *
 * 硬约束：处理器必须复用业务侧的数据范围校验，不能自己拼 WHERE。
 */
export interface IntentHandlerSpec {
  /** 处理器标识，在 AiHandlerRegistry 里注册 */
  kind: 'maintenance_expiry';
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
  /**
   * 多权限「任一即可」。用于跨类别的工具（例如到期清单同时覆盖人员与车辆）：
   * 有人员权限的只能看人员，有资产权限的只能看车辆油机 —— 具体裁剪在处理器内部做。
   */
  authAny?: readonly string[];
  /** RAG 问答类意图没有 SQL */
  sql?: IntentSqlSpec;
  /** 代码处理器（与 sql 二选一） */
  handler?: IntentHandlerSpec;
  /**
   * 路由描述（给大模型看的一句话）：
   *   `route: { desc }` = 上架，可被模型选中；
   *   `route: null`      = 明确不上架（有执行能力但不开放给路由，例如知识库为空时的问答）；
   *   `route` 缺省        = 忘了写 —— 启动时会在 /ai/status 的 router.missingDesc 里点名。
   *
   * 为什么不复用 summary：summary 是**结论模板**，带 `{top1.xxx}` 占位符，
   * 塞进 prompt 既费 token 又干扰模型判断。所以仍需人工写一句"能回答什么问题"，
   * 但只写在这一处，参数说明由 intent.params 确定性派生 —— 消除双写。
   */
  route?: { desc: string } | null;
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
