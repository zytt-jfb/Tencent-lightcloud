import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { BizAuthContext } from '../../rbac/rbac.service';
import { IntentRegistry } from '../intents/intent-registry';
import type { Intent, IntentParams } from '../intents/intent.types';
import { LlmClientService } from './llm-client.service';
import { buildRouterMessages, type RouterToolSpec } from './prompts/router.prompt';
import { ROUTER_TOOL_SPECS } from './tool-specs';

/**
 * 路由总预算（不是单次超时）。
 * 失败即降级，所以只给一次尝试：8s 超时 × 3 次重试 + 退避 ≈ 25s，
 * 那已经不是"兜底"，而是把用户的等待时间翻了几十倍。
 */
const ROUTE_BUDGET_MS = 9_000;
/** 输出上限：推理模型的 reasoning 也计入 max_tokens，给 200 会被吃光导致 content 为空串 */
const ROUTE_MAX_TOKENS = 1_200;

export interface RouteOutcome {
  intent: Intent;
  params: IntentParams;
  confidence: number;
}

interface RawRoute {
  tool?: unknown;
  params?: unknown;
  confidence?: unknown;
  reason_code?: unknown;
}

/**
 * 意图路由（大模型只做「选工具 + 填参数」，不碰 SQL 与数字）
 *
 * 几个刻意的边界：
 *   1. **只发给模型有权限的工具**。无权限的工具连描述都不进 prompt，
 *      模型不可能选到它，也就不存在「选了才发现没权限」的尴尬。
 *   2. **参数服务端二次校验**。模型的返回值一律当作不可信输入：
 *      键必须在 intent.params 声明里、月份必须是合法 YYYY-MM、年份必须落在候选区间、
 *      枚举必须命中 values。任何一项不过就整条丢弃，退回功能清单 —— 不"尽力修正"。
 *   3. **时间由服务端算好注入**。模型对"今天是几号"的认知是错的（实测以为 2026-05），
 *      所以在提示词里直接给今天/本月/上月/今年/去年的值，它只需要做选择。
 *   4. **失败即降级**。超时、4xx、JSON 解析失败、tool 不在清单 —— 全部返回 null，
 *      调用方回落到原有规则链路，主流程不因为模型抽风而报错。
 */
@Injectable()
export class IntentRouterService {
  private readonly logger = new Logger(IntentRouterService.name);

  constructor(
    private readonly registry: IntentRegistry,
    private readonly llm: LlmClientService,
    private readonly config: ConfigService,
  ) {}

  get enabled(): boolean {
    return this.llm.status.enabled;
  }

  async route(auth: BizAuthContext, question: string): Promise<RouteOutcome | null> {
    if (!this.llm.status.enabled) return null;

    const tools = this.toolsFor(auth);
    if (tools.length === 0) return null;

    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const messages = buildRouterMessages({
      today: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
      currentMonth,
      lastMonth: `${lastMonthDate.getFullYear()}-${pad(lastMonthDate.getMonth() + 1)}`,
      currentYear: now.getFullYear(),
      lastYear: now.getFullYear() - 1,
      tools,
      question,
    });

    let text: string;
    try {
      text = await this.llm.chat(messages, {
        jsonMode: true,
        effort: 'low',
        maxTokens: ROUTE_MAX_TOKENS,
        timeoutMs: ROUTE_BUDGET_MS,
        maxAttempts: 1,
      });
    } catch (error) {
      this.logger.warn(`AI_ROUTE_LLM_FAILED message=${error instanceof Error ? error.message : String(error)}`);
      return null;
    }

    const raw = parseJsonObject(text);
    if (!raw) {
      this.logger.warn(`AI_ROUTE_BAD_JSON chars=${text.length}`);
      return null;
    }

    const toolId = typeof raw.tool === 'string' ? raw.tool.trim() : '';
    if (!toolId) return null; // 模型明确表示"没有这个能力"，交给调用方走引导清单

    const intent = this.registry.byId(toolId);
    if (!intent) {
      this.logger.warn(`AI_ROUTE_UNKNOWN_TOOL tool=${toolId}`);
      return null;
    }
    // 再挡一次：即便模型输出了清单外的工具（幻觉），也不能越过权限
    if (!this.registry.allows(auth, intent)) {
      this.logger.warn(`AI_ROUTE_FORBIDDEN tool=${toolId} user=${auth.username}`);
      return null;
    }

    const params = this.sanitizeParams(intent, raw.params, now);
    if (params === null) {
      this.logger.warn(`AI_ROUTE_BAD_PARAMS tool=${toolId}`);
      return null;
    }

    return {
      intent,
      params,
      confidence: typeof raw.confidence === 'number' ? raw.confidence : 0,
    };
  }

  /** 只把当前账号有权限的工具交给模型 */
  private toolsFor(auth: BizAuthContext): RouterToolSpec[] {
    return ROUTER_TOOL_SPECS.filter((spec) => {
      const intent = this.registry.byId(spec.id);
      return Boolean(intent && this.registry.allows(auth, intent));
    });
  }

  /**
   * 参数白名单与格式校验。返回 null 表示整条不可信，直接丢弃。
   *
   * 为什么严格到"一项不过就全丢"：留一半参数比不给更危险 ——
   * 用户看到的是一个看似正常、实际口径错位的结果。
   */
  private sanitizeParams(intent: Intent, rawParams: unknown, now: Date): IntentParams | null {
    const source = rawParams && typeof rawParams === 'object' ? (rawParams as Record<string, unknown>) : {};
    const out: IntentParams = {};
    // 36 个月：规则路径对月份没有窗口限制，模型路径若只给 13 个月，
    // 「2025年全年后评估趋势」这类合法查询会被整条丢弃（同样的话规则能查、模型不能），
    // 这种不一致会表现为"有时能答、有时答不了"，比直接不支持更难解释。
    const allowedMonths = monthWindow(now, 36);
    const allowedYears = [now.getFullYear(), now.getFullYear() - 1];

    for (const [name, spec] of Object.entries(intent.params)) {
      if (spec.from === 'month_range') {
        const from = pickMonth(source[`${name}From`], allowedMonths);
        const to = pickMonth(source[`${name}To`], allowedMonths);
        // 区间两端要么都给要么都不给；给反了直接丢（模型偶尔会把先后写颠倒）
        if ((from === null) !== (to === null)) return null;
        if (from && to && from > to) return null;
        out[`${name}From`] = from;
        out[`${name}To`] = to;
        continue;
      }

      const value = source[name];

      if (spec.enum) {
        if (value === null || value === undefined || value === '') {
          out[name] = spec.enum.defaultValue ?? null;
          continue;
        }
        if (typeof value !== 'string') return null;
        const raw = value.trim();
        if (spec.enum.values.includes(raw)) {
          out[name] = raw;
          continue;
        }
        // 模型可能照抄工具描述里的中文写法（"kind（personnel=人员 …）"），
        // 直接判非法会把选对了工具的请求整条丢掉，用户看到的是"没识别到"。
        const aliasHit = Object.entries(spec.enum.aliases ?? {}).find(([alias]) => alias === raw)?.[1];
        if (!aliasHit || !spec.enum.values.includes(aliasHit)) return null;
        out[name] = aliasHit;
        continue;
      }

      if (spec.from === 'month') {
        const month = pickMonth(value, allowedMonths);
        // 给了但格式不对 → 丢弃整条；没给 → null，由 applyDefaults 决定默认月份
        if (value !== null && value !== undefined && value !== '' && month === null) return null;
        out[name] = month;
        continue;
      }

      if (spec.from === 'year') {
        if (value === null || value === undefined || value === '') { out[name] = null; continue; }
        // 必须本身就是数字：Number(true)=1、Number([2026])=2026 这类隐式转换会放过脏值
        if (typeof value !== 'number' || !Number.isInteger(value) || !allowedYears.includes(value)) return null;
        out[name] = value;
        continue;
      }

      if (spec.from === 'days') {
        if (value === null || value === undefined || value === '') { out[name] = null; continue; }
        if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0 || value > 3650) return null;
        out[name] = value;
        continue;
      }

      // 其余参数类型（city_dictionary 等）由规则链路负责，模型给的一律不采信
      out[name] = null;
    }

    return out;
  }
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 从当前月往前 N 个月的合法集合，防止模型给出 2019-01 这种离谱月份 */
function monthWindow(now: Date, back: number): Set<string> {
  const base = now.getFullYear() * 12 + now.getMonth();
  const out = new Set<string>();
  for (let i = 0; i < back; i += 1) {
    const total = base - i;
    const year = Math.floor(total / 12);
    const month = (total % 12 + 12) % 12;
    out.add(`${year}-${pad(month + 1)}`);
  }
  return out;
}

function pickMonth(value: unknown, allowed: Set<string>): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!/^\d{4}-\d{2}$/.test(text)) return null;
  return allowed.has(text) ? text : null;
}

/**
 * 解析模型输出。除了正常的 JSON，还要容忍两种常见包裹：
 *   ```json {…} ``` 代码块、以及前后夹带的解释文字。
 * 解析不出来就返回 null，由调用方降级 —— 不做"猜一个最像的 JSON"这种操作。
 */
function parseJsonObject(text: string): RawRoute | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const candidates = [trimmed];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as RawRoute;
    } catch {
      /* 试下一个候选 */
    }
  }
  return null;
}
