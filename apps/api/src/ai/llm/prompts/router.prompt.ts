import type { LlmMessage } from '../llm-provider.interface';

/**
 * 意图路由提示词（预置注入，版本化管理）
 *
 * 这一层是「真智能」唯一允许碰业务语义的地方：把一句人话映射到已注册的查询工具。
 * 它**不回答业务问题、不计算数字、不生成 SQL** —— 数字与口径全部由下游的
 * 确定性管线（scope-guard → sql-guard → 只读库 → 聚合模板）负责。
 *
 * 写这份提示词踩过的两个坑（改之前先读）：
 *   1. 模型对"今天是几号"的内部认知是错的（实测它以为当前是 2026-05），
 *      所以时间**必须由服务端算好注入**，并在提示词里明确今天/本月/上月/今年的值。
 *      绝不能让模型自己去推「上个月是哪个月」。
 *   2. DeepSeek 的 json_object 模式要求 prompt 里出现 "json" 字样，否则直接 400。
 *      这里固定写在输出要求里，适配器另有一道兜底。
 *
 * 版本：v1（2026-10-26）
 */

/** 注入给路由器的工具描述（由 Intent 派生，不要在提示词里手抄业务字段） */
export interface RouterToolSpec {
  id: string;
  /** 一句话：这个工具能回答什么问题 */
  desc: string;
  /** 允许的参数键，逗号分隔；空表示无参数 */
  params: string;
}

export interface RouterPromptInput {
  /** 今天，YYYY-MM-DD（服务端注入） */
  today: string;
  /** 当前月，YYYY-MM */
  currentMonth: string;
  /** 上个月，YYYY-MM */
  lastMonth: string;
  /** 当前年 */
  currentYear: number;
  /** 去年 */
  lastYear: number;
  tools: readonly RouterToolSpec[];
  question: string;
}

const ROLE = '你是「业务查数工具」的路由器。';

const RULES = `你的唯一工作：把用户的一句话映射到下面工具清单里的一个工具，并按该工具允许的参数填值。

绝对规则（违反即失效）：
1. 只能输出清单里存在的 tool id。清单里没有对应能力的，tool 必须为 null。
2. 你不回答业务问题、不计算任何数字、不推测数据内容。你只做"选哪个工具"。
3. params 只能填该工具「参数」列出的键，不许新增键。值只能取「候选值」里出现的；候选里没有就填 null。
4. 用户问的东西清单里完全没有（例如订单、人员、车辆、油机、巡检、FSU、上传文件），tool=null，reason_code 填 unsupported。
5. 时间一律输出 YYYY-MM（月份）或整数（年份）。今天是 {today}，本月={currentMonth}，上个月={lastMonth}，今年={currentYear}，去年={lastYear}。
   用户说"上个月"就填 {lastMonth}；说"8月"且没写年份，按今年补成 {currentYear}-08；说"26年8月"是 {currentYear}-08。
6. 只输出 json，不要任何解释、不要 markdown 代码块。`;

/**
 * 选工具判据。
 *
 * **刻意不写任何工具 id 或工具全名**：判据是固定文案，而可用工具是按账号权限过滤的。
 * 一旦这里点了名，没有该权限的账号也会在 prompt 里看到"存在这个工具"，
 * 既泄漏功能边界，也会诱导模型去选一个它根本拿不到的工具。
 * 所以只用业务概念描述，具体对应哪个工具由模型从清单里自己找。
 */
const SELECT_RULES = `选工具的判据（"清单里的名字"指工具清单第二列）：
- 用户说「代维单位」「供应商」→ 选名字里带「供应商」的排名工具，**不要**选地市排名。
- 用户说「地市」「城市」「哪个市」「各地」→ 选名字里带「地市」的排名工具。
- 用户只说领域词（如「后评估」「考核」）而没说要看什么 → 选该领域的汇总工具。
- 用户要「趋势 / 走势 / 环比 / 变化 / 逐月」→ 选名字里带「趋势」的工具。
- 用户要「明细 / 有哪些项目 / 列出来」→ 选名字里带「明细」的工具。
- 用户问「等级 / ABCD」→ 选名字里带「等级」的工具。
- 用户问「合同到期 / 续签 / 快到期」→ 选名字里带「合同」且与「到期」有关的工具。
- 用户问证照、保险、资格证、无证上岗、续保、保养到期 → 选名字与「证照保险到期」相关的工具；提到人员/电工证/登高证把 kind 填 personnel，车辆/交强险/商业险填 vehicles，油机填 generators，没指明填 all。
- 用户问「多少条 / 几条 / 几个」这类计数，若清单里有对应汇总工具就选它，否则 null。
- 用户问某个实体（供应商/地市/项目）的「数量 / 项目数 / 单元数」时，选对应的排名工具（它自带计数字段），不要因为问句里没有"排名"两个字就拒答。
- 用户提到具体地市名（如"济南""济宁"）不需要写进 params，服务端会从原话里识别；你只负责选对工具。
- 用户问「多久 / 几天内到期」→ 选合同到期类工具，days 填数字（如"三个月"填 90）。`;

const OUTPUT_SPEC = `输出 json 结构（字段固定，不要增减）：
{"tool":"<工具 id 或 null>","params":{},"confidence":0.0,"reason_code":"matched"}
reason_code 取值：matched（选到了工具）| unsupported（没有这个能力）| ambiguous（像是某个工具但拿不准，confidence 给低值）。`;

/**
 * few-shot：覆盖「该选对的」「容易选错的」「该拒绝的」三类。
 *
 * 示例同样按可用工具过滤 —— 示例里出现的工具 id 也是一种泄漏：
 * 没有该权限的账号不该从 few-shot 里知道系统有"合同作废"这种能力。
 */
function examples(input: RouterPromptInput): LlmMessage[] {
  const y = input.currentYear;
  const available = new Set(input.tools.map((tool) => tool.id));
  const cases: Array<{ question: string; reply: string; needs: string | null }> = [
    {
      needs: 'assessment.city_rank',
      question: '2026年8月后评估排名',
      reply: `{"tool":"assessment.city_rank","params":{"month":"${y}-08"},"confidence":0.97,"reason_code":"matched"}`,
    },
    {
      // 只说领域词 → 给汇总，不是排名
      needs: 'assessment.month_summary',
      question: '后评估',
      reply: `{"tool":"assessment.month_summary","params":{"month":"${input.lastMonth}"},"confidence":0.72,"reason_code":"matched"}`,
    },
    {
      // 关键陷阱：代维单位 = 供应商，不能落到地市排名
      needs: 'assessment.supplier_rank',
      question: '代维单位后评估排行',
      reply: `{"tool":"assessment.supplier_rank","params":{"month":"${input.lastMonth}"},"confidence":0.93,"reason_code":"matched"}`,
    },
    {
      needs: 'assessment.month_summary',
      question: '26年8月后评估',
      reply: `{"tool":"assessment.month_summary","params":{"month":"${y}-08"},"confidence":0.9,"reason_code":"matched"}`,
    },
    {
      // 月度考核只有年度口径，不要臆造月份参数
      needs: 'performance.organization_rank',
      question: '本月代维考核',
      reply: `{"tool":"performance.organization_rank","params":{"year":${y}},"confidence":0.75,"reason_code":"matched"}`,
    },
    {
      needs: 'maintenance.expiry',
      question: '保险快过期的人有哪些',
      reply: '{"tool":"maintenance.expiry","params":{"kind":"personnel","windowDays":30},"confidence":0.88,"reason_code":"matched"}',
    },
    {
      // 没有这个能力 → 必须拒绝，不许勉强归类
      needs: null,
      question: '上传人员',
      reply: '{"tool":null,"params":{},"confidence":0.0,"reason_code":"unsupported"}',
    },
    {
      needs: null,
      question: '你好',
      reply: '{"tool":null,"params":{},"confidence":0.0,"reason_code":"unsupported"}',
    },
  ];

  const out: LlmMessage[] = [];
  for (const item of cases) {
    if (item.needs && !available.has(item.needs)) continue;
    out.push({ role: 'user', content: item.question });
    out.push({ role: 'assistant', content: item.reply });
  }
  return out;
}

/** 月份候选：从当前月往前 13 个月，帮模型把"8月"规范成 YYYY-08 */
export function monthCandidates(currentMonth: string, back = 13): string[] {
  const [yearText, monthText] = currentMonth.split('-');
  const base = Number(yearText) * 12 + (Number(monthText) - 1);
  const out: string[] = [];
  for (let i = 0; i < back; i += 1) {
    const total = base - i;
    const year = Math.floor(total / 12);
    const month = (total % 12 + 12) % 12;
    out.push(`${year}-${String(month + 1).padStart(2, '0')}`);
  }
  return out;
}

/**
 * 构建路由请求的 messages。
 *
 * 注意 few-shot 放在「规则之后、真正问句之前」，且最后一条必须是用户的真实问句
 * —— 这样模型不会把示例当成本次请求的内容。
 */
export function buildRouterMessages(input: RouterPromptInput): LlmMessage[] {
  const system = [
    ROLE,
    RULES,
    `工具清单（格式：id | 能回答什么 | 参数）：\n${
      input.tools.map((tool) => `- ${tool.id} | ${tool.desc} | ${tool.params || '无'}`).join('\n')
    }`,
    `候选值：\n月份：${monthCandidates(input.currentMonth).join(', ')}\n年份：${input.lastYear}, ${input.currentYear}`,
    SELECT_RULES,
    OUTPUT_SPEC,
  ].join('\n\n');

  return [
    { role: 'system', content: system },
    ...examples(input),
    { role: 'user', content: input.question },
  ];
}
