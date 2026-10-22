import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Inject } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { BizAuthContext } from '../rbac/rbac.service';
import { AI_SEMAPHORE_TOKEN, AiBusyError, Semaphore } from './concurrency/semaphore';
import { AiChatDto, AiFeedbackDto, AiReportDto } from './dto/ai-chat.dto';
import { FlywheelService } from './flywheel/flywheel.service';
import { ScopeGuardService, type ScopePredicate } from './auth/scope-guard.service';
import { deriveParamNames } from './intents/intent-params';
import { extractParams } from './intents/intent-params';
import { IntentRegistry } from './intents/intent-registry';
import type { GuideItem, Intent, IntentCategory, IntentColumnSpec, IntentParams } from './intents/intent.types';
import { LlmClientService } from './llm/llm-client.service';
import { RagService } from './rag/rag.service';
import { ReportService, renderTemplate } from './report/report.service';
import { ReadonlyDataSource, ReadonlyUnavailableError, type SqlParam } from './sql/readonly-datasource';
import { SqlAgentService } from './sql/sql-agent.service';
import { SqlGuardError } from './sql/sql-guard';
import { SqliteStore } from './sql/sqlite.store';

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

export interface AiChatResponse {
  type: 'answer' | 'guide' | 'ask_param' | 'knowledge';
  intentId?: string | null;
  intentName?: string | null;
  category?: IntentCategory | null;
  summary: string;
  chart?: unknown;
  columns?: IntentColumnSpec[];
  rows?: Array<Record<string, unknown>>;
  chunks?: Array<{ sourcePath: string; title: string | null; section: string | null; excerpt: string }>;
  guide?: GuideItem[];
  missing?: Array<{ name: string; label: string }>;
  meta: AiChatMeta;
}

/** 把抽取出来的参数值转成驱动可接受的标量（undefined 一律变 null，绝不交给驱动猜） */
function toSqlValue(value: string | number | null | undefined): SqlParam {
  if (value === undefined || value === null) return null;
  return value;
}

/** 'YYYY-MM' 月份加减，返回 'YYYY-MM'（不引 dayjs，纯算术避免依赖） */
function shiftMonth(month: string, delta: number): string {
  const [yearText, monthText] = month.split('-');
  const base = Number(yearText) * 12 + (Number(monthText) - 1) + delta;
  const year = Math.floor(base / 12);
  const nextMonth = (base % 12 + 12) % 12;
  return `${year}-${String(nextMonth + 1).padStart(2, '0')}`;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * AI 门面服务
 *
 * 一次请求的完整链路（顺序不能变）：
 *   意图匹配 → 权限校验 → 参数抽取 → 数据范围注入 → SQL 护栏 → 执行 → 组装 → 落飞轮
 *
 * 强调两点：
 *   · 数据范围注入在 SQL 执行之前，且 scope 只来自 auth（用户输入无法影响）；
 *   · 任何一步失败都会落一条飞轮记录（status 标明原因），
 *     这样「用户说查不到」时能在审计表里看到是没权限、没数据、还是模板坏了。
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly registry: IntentRegistry,
    private readonly scopeGuard: ScopeGuardService,
    private readonly sqlAgent: SqlAgentService,
    private readonly reportService: ReportService,
    private readonly flywheel: FlywheelService,
    private readonly rag: RagService,
    private readonly llm: LlmClientService,
    private readonly readonlyDb: ReadonlyDataSource,
    private readonly sqlite: SqliteStore,
    private readonly config: ConfigService,
    @Inject(AI_SEMAPHORE_TOKEN) private readonly semaphore: Semaphore,
  ) {}

  private get ragTopK(): number {
    const raw = Number.parseInt(String(this.config.get<string>('AI_RAG_TOP_K') ?? ''), 10);
    return Number.isFinite(raw) ? Math.min(20, Math.max(1, raw)) : 5;
  }

  async chat(auth: BizAuthContext, dto: AiChatDto): Promise<AiChatResponse> {
    const startedAt = Date.now();
    const traceId = randomUUID();
    const question = dto.question.trim();

    const match = this.registry.match(question);
    if (!match) return this.guide(auth, question, traceId, startedAt);

    const intent = match.intent;
    this.assertPermission(auth, intent, question, traceId, startedAt);

    const cityNames = await this.scopeGuard.cityNames();
    const { params, missing } = extractParams(intent, question, { cityNames });
    if (missing.length > 0) return this.askParam(intent, question, traceId, startedAt, missing);

    return this.runIntent(auth, intent, params, {
      traceId,
      question,
      startedAt,
      source: intent.category === 'qa' ? 'qa' : 'rule',
    });
  }

  /** 按意图生成报告（前端点选功能清单时用） */
  async report(auth: BizAuthContext, dto: AiReportDto): Promise<AiChatResponse> {
    const startedAt = Date.now();
    const traceId = randomUUID();
    const intent = this.registry.byId(dto.intentId);
    if (!intent) throw new NotFoundException('没有这个功能');

    this.assertPermission(auth, intent, `[report] ${dto.intentId}`, traceId, startedAt);

    // 只接受 intent 声明过的参数键，其余丢弃（防止有人塞奇怪的东西进来）
    const params: IntentParams = {};
    for (const [name, spec] of Object.entries(intent.params)) {
      const raw = dto.params?.[name];
      if (spec.from === 'month_range') {
        params[`${name}From`] = (dto.params?.[`${name}From`] as string) ?? null;
        params[`${name}To`] = (dto.params?.[`${name}To`] as string) ?? null;
        continue;
      }
      params[name] = raw === undefined || raw === null || raw === '' ? null : raw;
    }

    return this.runIntent(auth, intent, params, {
      traceId,
      question: `[report] ${intent.name}`,
      startedAt,
      source: intent.category === 'qa' ? 'qa' : 'rule',
    });
  }

  /** 当前账号可用的功能清单 */
  intents(auth: BizAuthContext): { items: GuideItem[]; rejected: Array<{ id: string; reason: string }> } {
    return { items: this.registry.guideFor(auth), rejected: [...this.registry.rejectedIntents] };
  }

  feedback(auth: BizAuthContext, dto: AiFeedbackDto): { ok: boolean } {
    const ok = this.flywheel.setFeedback(auth, dto.eventId, dto.feedback, dto.note ?? null);
    if (!ok) throw new NotFoundException('记录不存在或不属于当前账号');
    return { ok };
  }

  /** 运维自检（仅超管）：一眼看出哪一环没配好 */
  status(auth: BizAuthContext): Record<string, unknown> {
    if (!auth.isSuperAdmin) throw new ForbiddenException('仅超级管理员可查看');
    return {
      sqlite: this.sqlite.status,
      readonlyDatabase: this.readonlyDb.status,
      llm: this.llm.status,
      concurrency: this.semaphore.stats,
      intents: { total: this.registry.all.length, rejected: [...this.registry.rejectedIntents] },
      rag: { chunks: this.rag.count(), topK: this.ragTopK },
      flywheel: this.flywheel.stats(),
    };
  }

  recent(auth: BizAuthContext, limit = 20): Record<string, unknown> {
    if (!auth.isSuperAdmin) throw new ForbiddenException('仅超级管理员可查看');
    return { items: this.flywheel.recent(limit) };
  }

  // ==========================================================================
  // 内部实现
  // ==========================================================================

  private assertPermission(
    auth: BizAuthContext,
    intent: Intent,
    question: string,
    traceId: string,
    startedAt: number,
  ): void {
    if (!intent.auth || auth.isSuperAdmin || auth.permissionCodes.has(intent.auth)) return;
    this.flywheel.record({
      userId: auth.userId,
      username: auth.username,
      roleCode: auth.roleCode,
      rawInput: question,
      matchedIntentId: intent.id,
      intentSource: 'rule',
      status: 'forbidden',
      errorCode: `MISSING_PERMISSION:${intent.auth}`,
      latencyMs: Date.now() - startedAt,
      traceId,
    });
    throw new ForbiddenException(`当前账号没有使用该功能的权限（需要 ${intent.auth}）`);
  }

  private guide(auth: BizAuthContext, question: string, traceId: string, startedAt: number): AiChatResponse {
    const items = this.registry.guideFor(auth);
    const latencyMs = Date.now() - startedAt;
    const eventId = this.flywheel.record({
      userId: auth.userId,
      username: auth.username,
      roleCode: auth.roleCode,
      rawInput: question,
      intentSource: 'guide',
      status: 'not_matched',
      errorCode: 'NO_INTENT_MATCH',
      rowCount: 0,
      latencyMs,
      traceId,
    });
    return {
      type: 'guide',
      summary: items.length > 0
        ? '没有识别到具体功能。可以从下面选一个，或换个更具体的说法（例如带上月份）。'
        : '当前账号没有可用功能，请联系管理员配置权限。',
      guide: items,
      meta: this.meta({ traceId, eventId, rowCount: 0, latencyMs, truncated: false, source: 'guide', scopeLabel: '—' }),
    };
  }

  private askParam(
    intent: Intent,
    question: string,
    traceId: string,
    startedAt: number,
    missing: Array<{ name: string; label: string }>,
  ): AiChatResponse {
    const latencyMs = Date.now() - startedAt;
    return {
      type: 'ask_param',
      intentId: intent.id,
      intentName: intent.name,
      category: intent.category,
      summary: `还需要你补充：${missing.map((item) => item.label).join('、')}。例如「2026-09 ${intent.name}」。`,
      missing,
      meta: this.meta({
        traceId,
        eventId: null,
        rowCount: 0,
        latencyMs,
        truncated: false,
        source: 'rule',
        scopeLabel: '—',
      }),
    };
  }

  private async runIntent(
    auth: BizAuthContext,
    intent: Intent,
    params: IntentParams,
    ctx: { traceId: string; question: string; startedAt: number; source: 'rule' | 'qa' },
  ): Promise<AiChatResponse> {
    // 知识库问答：不查业务库，直接用本地片段
    if (!intent.sql) return this.answerKnowledge(auth, intent, params, ctx);

    let scope: ScopePredicate;
    try {
      scope = await this.scopeGuard.resolve(auth, {
        column: intent.sql.scopeColumn,
        valueType: intent.sql.scopeValueType,
      });
    } catch (error) {
      this.flywheel.record({
        userId: auth.userId,
        username: auth.username,
        roleCode: auth.roleCode,
        rawInput: ctx.question,
        matchedIntentId: intent.id,
        intentSource: ctx.source,
        status: 'forbidden',
        errorCode: 'SCOPE_DENIED',
        latencyMs: Date.now() - ctx.startedAt,
        traceId: ctx.traceId,
      });
      throw error;
    }

    await this.applyDefaults(intent, params, scope);

    const sql = intent.sql.text.replace('{{scope}}', scope.sql);
    const paramNames = deriveParamNames(intent);
    const sqlParams: SqlParam[] = [...scope.params, ...paramNames.map((name) => toSqlValue(params[name]))];

    let result;
    try {
      result = await this.sqlAgent.execute({ sql, params: sqlParams });
    } catch (error) {
      throw this.translateError(error, auth, intent, ctx, sql);
    }

    const built = result.rowCount === 0
      ? { chart: null as unknown, table: { columns: intent.columns ?? [], rows: [] as Array<Record<string, unknown>> }, summary: this.reportService.emptySummary(intent, params) }
      : this.reportService.build(intent, result.rows, params);

    const latencyMs = Date.now() - ctx.startedAt;
    const eventId = this.flywheel.record({
      userId: auth.userId,
      username: auth.username,
      roleCode: auth.roleCode,
      rawInput: ctx.question,
      matchedIntentId: intent.id,
      intentSource: ctx.source,
      sqlText: result.sql,
      params,
      rowCount: result.rowCount,
      latencyMs,
      status: 'ok',
      traceId: ctx.traceId,
    });

    return {
      type: 'answer',
      intentId: intent.id,
      intentName: intent.name,
      category: intent.category,
      summary: built.summary,
      chart: built.chart,
      columns: built.table.columns,
      rows: built.table.rows,
      meta: this.meta({
        traceId: ctx.traceId,
        eventId,
        rowCount: result.rowCount,
        latencyMs,
        truncated: result.truncated,
        source: ctx.source,
        scopeLabel: scope.label,
      }),
    };
  }

  private answerKnowledge(
    auth: BizAuthContext,
    intent: Intent,
    params: IntentParams,
    ctx: { traceId: string; question: string; startedAt: number },
  ): AiChatResponse {
    const chunks = this.rag.search(ctx.question, this.ragTopK);
    const latencyMs = Date.now() - ctx.startedAt;
    const eventId = this.flywheel.record({
      userId: auth.userId,
      username: auth.username,
      roleCode: auth.roleCode,
      rawInput: ctx.question,
      matchedIntentId: intent.id,
      intentSource: 'qa',
      rowCount: chunks.length,
      latencyMs,
      status: 'ok',
      traceId: ctx.traceId,
    });

    if (chunks.length === 0) {
      return {
        type: 'knowledge',
        intentId: intent.id,
        intentName: intent.name,
        category: intent.category,
        summary: this.reportService.emptySummary(intent, params),
        chunks: [],
        meta: this.meta({
          traceId: ctx.traceId,
          eventId,
          rowCount: 0,
          latencyMs,
          truncated: false,
          source: 'qa',
          scopeLabel: '—',
        }),
      };
    }

    return {
      type: 'knowledge',
      intentId: intent.id,
      intentName: intent.name,
      category: intent.category,
      summary: renderTemplate(intent.summary, [], params, chunks.length),
      chunks: chunks.map((chunk) => ({
        sourcePath: chunk.sourcePath,
        title: chunk.title,
        section: chunk.section,
        excerpt: chunk.content.slice(0, 300),
      })),
      meta: this.meta({
        traceId: ctx.traceId,
        eventId,
        rowCount: chunks.length,
        latencyMs,
        truncated: false,
        source: 'qa',
        scopeLabel: '—',
      }),
    };
  }

  /** 参数缺省值：全部由服务端决定，前端无法指定「默认看哪个月」 */
  private async applyDefaults(intent: Intent, params: IntentParams, scope: ScopePredicate): Promise<void> {
    for (const [name, spec] of Object.entries(intent.params)) {
      const kind = spec.defaultValue?.kind;

      if (spec.from === 'month_range') {
        const from = params[`${name}From`];
        const to = params[`${name}To`];
        if (from && to) continue;
        if (kind === 'ytd_months') {
          const now = currentMonth();
          params[`${name}From`] = `${now.slice(0, 4)}-01`;
          params[`${name}To`] = now;
        } else {
          // 兜底：最近 6 个月
          const now = currentMonth();
          params[`${name}From`] = shiftMonth(now, -5);
          params[`${name}To`] = now;
        }
        continue;
      }

      if (params[name] !== null && params[name] !== undefined && params[name] !== '') continue;
      if (!kind) continue;

      if (kind === 'latest_eval_month') {
        params[name] = await this.latestEvalMonth(scope);
      } else if (kind === 'current_year') {
        params[name] = new Date().getFullYear();
      } else if (kind === 'next_days') {
        params[name] = spec.defaultValue && 'days' in spec.defaultValue ? spec.defaultValue.days : 90;
      }
    }
  }

  /** 查当前范围内最新一个有数据的后评估月份（内部固定 SQL，表名与条件都是常量） */
  private async latestEvalMonth(scope: ScopePredicate): Promise<string> {
    const sql = `SELECT MAX(eval_month) AS m FROM biz_assessment_record WHERE ${scope.sql} AND status = 'active' LIMIT 1`;
    const result = await this.sqlAgent.execute({ sql, params: scope.params });
    const value = result.rows[0]?.m;
    if (!value) throw new BadRequestException('当前数据范围内没有任何后评估记录，无法推断默认月份');
    return String(value);
  }

  /** 把底层错误翻译成用户能理解的状态码，并落一条飞轮 */
  private translateError(
    error: unknown,
    auth: BizAuthContext,
    intent: Intent,
    ctx: { traceId: string; question: string; startedAt: number; source: 'rule' | 'qa' },
    sql: string,
  ): Error {
    const latencyMs = Date.now() - ctx.startedAt;
    const record = (status: 'error' | 'unconfigured' | 'forbidden', code: string): void => {
      this.flywheel.record({
        userId: auth.userId,
        username: auth.username,
        roleCode: auth.roleCode,
        rawInput: ctx.question,
        matchedIntentId: intent.id,
        intentSource: ctx.source,
        sqlText: sql,
        status,
        errorCode: code,
        latencyMs,
        traceId: ctx.traceId,
      });
    };

    if (error instanceof AiBusyError) {
      record('error', 'AI_BUSY');
      return new HttpException('AI 查询繁忙，请几秒后重试', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (error instanceof ReadonlyUnavailableError) {
      record('unconfigured', error.code);
      return new ServiceUnavailableException(
        error.code === 'NOT_CONFIGURED'
          ? 'AI 只读数据源尚未配置（READONLY_DSN 为空），请联系管理员'
          : `AI 只读数据源不可用：${error.message}`,
      );
    }
    if (error instanceof SqlGuardError) {
      record('error', `SQL_GUARD:${error.code}`);
      this.logger.error(`AI_SQL_GUARD_BLOCKED intent=${intent.id} code=${error.code} message=${error.message}`);
      return new BadRequestException('查询模板校验未通过，请联系管理员');
    }
    record('error', 'QUERY_FAILED');
    return error instanceof Error ? error : new Error(String(error));
  }

  private meta(input: {
    traceId: string;
    eventId: number | null;
    rowCount: number;
    latencyMs: number;
    truncated: boolean;
    source: 'rule' | 'qa' | 'guide';
    scopeLabel: string;
  }): AiChatMeta {
    return {
      traceId: input.traceId,
      eventId: input.eventId,
      rowCount: input.rowCount,
      latencyMs: input.latencyMs,
      truncated: input.truncated,
      intentSource: input.source,
      scopeLabel: input.scopeLabel,
      llmEnabled: this.llm.status.enabled,
    };
  }
}
