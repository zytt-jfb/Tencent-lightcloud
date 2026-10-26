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
import { BizPermissionCode } from '@biz-reporting/shared-types';
import type { BizAuthContext } from '../rbac/rbac.service';
import { AI_SEMAPHORE_TOKEN, AiBusyError, Semaphore } from './concurrency/semaphore';
import { AiChatDto, AiFeedbackDto, AiReportDto } from './dto/ai-chat.dto';
import { FlywheelService } from './flywheel/flywheel.service';
import { MaintenanceExpiryHandler } from './handlers/maintenance-expiry.handler';
import { decodeUploadFilename } from '../maintenance/maintenance-batch-import.service';
import { IntentRouterService } from './llm/intent-router.service';
import { ROUTER_TOOL_SPECS } from './llm/tool-specs';
import { ScopeGuardService, type ScopePredicate } from './auth/scope-guard.service';
import { deriveParamNames, extractParams, findCityInInput } from './intents/intent-params';
import { IntentRegistry } from './intents/intent-registry';
import type { GuideItem, Intent, IntentCategory, IntentColumnSpec, IntentParams } from './intents/intent.types';
import { LlmClientService } from './llm/llm-client.service';
import { RagService } from './rag/rag.service';
import { ReportService, renderTemplate } from './report/report.service';
import { ReadonlyDataSource, ReadonlyUnavailableError, type SqlParam } from './sql/readonly-datasource';
import { SqlAgentService } from './sql/sql-agent.service';
import { SqlGuardError } from './sql/sql-guard';
import { SqliteStore } from './sql/sqlite.store';
import { chunkFile } from './rag/chunking';
import { AGENT_ACTIONS, AGENT_ACTION_GROUPS } from './tools/action-tools';

/** 单个知识库文件上限：再大就不是"制度/口径"了，应该走业务导入 */
const MAX_KNOWLEDGE_BYTES = 10 * 1024 * 1024;

export interface AiChatMeta {
  traceId: string;
  eventId: number | null;
  rowCount: number;
  latencyMs: number;
  truncated: boolean;
  intentSource: 'rule' | 'qa' | 'llm' | 'guide';
  scopeLabel: string;
  /** 范围降级说明（例如指定的地市没定位到，已按全部授权范围查） */
  scopeNotice?: string | null;
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
    private readonly maintenanceExpiry: MaintenanceExpiryHandler,
    private readonly intentRouter: IntentRouterService,
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
    if (!match) {
      // 规则未命中才走大模型：常见问法（约 3/4）仍然是百毫秒级的纯规则路径，
      // 不因为「接入了模型」就让所有请求都多付 1~2 秒延迟和 token 成本。
      const routed = await this.routeWithLlm(auth, question, traceId, startedAt);
      if (routed) return routed;
      return this.guide(auth, question, traceId, startedAt);
    }

    const intent = match.intent;
    this.assertPermission(auth, intent, question, traceId, startedAt);

    const cityNames = await this.scopeGuard.cityNames();
    const { params, missing } = extractParams(intent, question, { cityNames });
    if (missing.length > 0) return this.askParam(intent, question, traceId, startedAt, missing);

    // 指定地市下钻：从问句抽取城市名；命中授权集合才生效，否则 scope-guard 直接拒绝
    const overrideCity = findCityInInput(question, cityNames) ?? null;

    return this.runIntent(auth, intent, params, {
      traceId,
      question,
      startedAt,
      source: intent.category === 'qa' ? 'qa' : 'rule',
      overrideCity,
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
      // 只接受标量：AiReportDto.params 仅校验了 @IsObject()，对象/数组被塞进
      // mysql2 的 execute 参数会直接抛错 → 500。这里直接降级为 null（走默认值）。
      params[name] = typeof raw === 'string' || typeof raw === 'number' ? raw : null;
    }

    return this.runIntent(auth, intent, params, {
      traceId,
      question: `[report] ${intent.name}`,
      startedAt,
      source: intent.category === 'qa' ? 'qa' : 'rule',
      overrideCity: null,
    });
  }

  /** 当前账号可用的功能清单 */
  intents(auth: BizAuthContext): { items: GuideItem[]; rejected: Array<{ id: string; reason: string }> } {
    return { items: this.registry.guideFor(auth), rejected: [...this.registry.rejectedIntents] };
  }

  /**
   * 批量导入类型清单（AI 助手里的统一导入入口）
   *
   * 只做「清单 + 权限过滤」，不做转发：
   *   真正的写入仍由各模块自己的接口完成 —— 那边有事务、批次血缘、行级范围校验，
   *   在 AI 层复制一遍只会多出一套会漂移的实现。
   *
   * 双闸：
   *   1. 没有 assistant.import.execute → 返回空清单，前端连入口都不显示；
   *   2. 有开关但缺某模块写权限 → 只隐藏那一项，不影响其它。
   *
   * mode 决定前端交互：
   *   direct          —— 选文件后一次提交即完成（合同/订单/绩效）
   *   preview-commit  —— 先预检拿统计与错误行，确认后再提交（后评估/人员/车辆/油机）
   */
  importTypes(auth: BizAuthContext): { items: Array<Record<string, unknown>> } {
    const allowed = (code: string): boolean => auth.isSuperAdmin || auth.permissionCodes.has(code);
    if (!allowed(BizPermissionCode.ASSISTANT_IMPORT_EXECUTE)) return { items: [] };

    const catalog: Array<Record<string, unknown> & { writePermission: string }> = [
      {
        key: 'contracts', name: '合同台账', group: '经营管理', mode: 'direct',
        endpoint: '/biz/contracts/upload', accept: '.xlsx',
        writePermission: BizPermissionCode.OPERATION_CONTRACT_CREATE,
        hint: '单工作表；必填列：合同编号、合同名称、含税合同额、所属省份',
      },
      {
        key: 'orders', name: '订单', group: '经营管理', mode: 'direct',
        endpoint: '/biz/orders/upload', accept: '.xlsx',
        writePermission: BizPermissionCode.OPERATION_ORDER_UPLOAD,
        hint: '超大文件请到订单页用分片上传',
      },
      {
        key: 'performance', name: '月度考核', group: '维护管理', mode: 'direct',
        endpoint: '/biz/performance/upload', accept: '.xlsx',
        writePermission: BizPermissionCode.PERFORMANCE_UPLOAD_CREATE,
        hint: '只能有一个明细 Sheet',
      },
      {
        key: 'assessment', name: '后评估数据', group: '工程管理', mode: 'preview-commit',
        previewEndpoint: '/biz/assessment/import/preview', commitEndpoint: '/biz/assessment/import', accept: '.xlsx',
        writePermission: BizPermissionCode.ASSESSMENT_IMPORT_UPLOAD,
        hint: '先预检再提交，重复行会单独计数',
      },
      {
        key: 'personnel', name: '人员', group: '维护管理', mode: 'preview-commit',
        previewEndpoint: '/biz/maintenance/personnel/import/preview', commitEndpoint: '/biz/maintenance/personnel/import',
        templateEndpoint: '/biz/maintenance/personnel/import/template', accept: '.xlsx',
        writePermission: BizPermissionCode.MAINTENANCE_DATA_WRITE,
        hint: '判重键：人员编号 + 所属公司 + 所属区域；列名对不上的列会被忽略',
      },
      {
        key: 'vehicles', name: '车辆', group: '维护管理', mode: 'preview-commit',
        previewEndpoint: '/biz/maintenance/vehicles/import/preview', commitEndpoint: '/biz/maintenance/vehicles/import',
        templateEndpoint: '/biz/maintenance/vehicles/import/template', accept: '.xlsx',
        writePermission: BizPermissionCode.MAINTENANCE_DATA_WRITE,
        hint: '判重键：车牌号 + 所属公司 + 所属区域',
      },
      {
        key: 'generators', name: '油机', group: '维护管理', mode: 'preview-commit',
        previewEndpoint: '/biz/maintenance/generators/import/preview', commitEndpoint: '/biz/maintenance/generators/import',
        templateEndpoint: '/biz/maintenance/generators/import/template', accept: '.xlsx',
        writePermission: BizPermissionCode.MAINTENANCE_DATA_WRITE,
        hint: '判重键：油机编号 + 所属公司 + 所属区域',
      },
    ];

    return {
      items: catalog
        .filter((item) => allowed(item.writePermission))
        .map(({ writePermission: _writePermission, ...rest }) => rest),
    };
  }

  /**
   * Agent 动作清单（当前账号能做的写操作）
   *
   * 只返回清单，不返回执行入口：写操作要么由用户在确认卡片上点，要么在拿到明确 id 后
   * 由后端代执行 —— 模型永远不直接触发写。清单本身按权限过滤，没有权限的连看都看不到，
   * 也就不会出现"点了才发现 403"。
   *
   * requiresLocate=true 表示动作路径里带记录 id，需要先按业务键（合同编号/成本单号）
   * 定位。定位器未接入前，前端应把这些显示为"到对应页面操作"，不能假装能一键完成。
   */
  actions(auth: BizAuthContext): Record<string, unknown> {
    const allowed = (code: string): boolean => auth.isSuperAdmin || auth.permissionCodes.has(code);
    return {
      groups: AGENT_ACTION_GROUPS,
      items: AGENT_ACTIONS
        .filter((action) => allowed(action.permission))
        .map(({ permission: _permission, ...rest }) => ({ ...rest, requiresLocate: Boolean(rest.resolve) })),
    };
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
      router: {
        enabled: this.intentRouter.enabled,
        // 上架给模型的工具数 vs 意图总数：差额就是"规则能命中但模型选不到"的工具
        tools: ROUTER_TOOL_SPECS.length,
        missingDesc: [...this.registry.missingRouteDesc],
      },
      rag: { chunks: this.rag.count(), topK: this.ragTopK },
      flywheel: this.flywheel.stats(),
    };
  }

  recent(auth: BizAuthContext, limit = 20): Record<string, unknown> {
    if (!auth.isSuperAdmin) throw new ForbiddenException('仅超级管理员可查看');
    return { items: this.flywheel.recent(limit) };
  }

  /**
   * 运营洞察（仅超管）
   *
   * 飞轮光记日志没有意义，得能回答：用户问了什么没答上来、哪类失败最多、
   * 规则和大模型各扛了多少。这三个问题的答案决定下一轮该补关键词还是修链路。
   */
  insights(auth: BizAuthContext, days = 30): Record<string, unknown> {
    if (!auth.isSuperAdmin) throw new ForbiddenException('仅超级管理员可查看');
    return this.flywheel.insights(Math.min(365, Math.max(1, days)));
  }

  // ==========================================================================
  // 知识库（RAG）维护
  //
  // 知识库是**全局公共资产**（制度、口径、历史报告），不是个人文件，所以不分 owner；
  // 权限收敛到超管。等将来要做"部门知识库"时，才需要在 chunks 上挂 owner 维度。
  // ==========================================================================

  knowledgeSources(auth: BizAuthContext): Record<string, unknown> {
    this.assertKnowledgeAdmin(auth);
    return { items: this.rag.listSources(), totalChunks: this.rag.count() };
  }

  knowledgeUpload(
    auth: BizAuthContext,
    file: { originalname: string; buffer: Buffer; size: number } | undefined,
  ): Record<string, unknown> {
    this.assertKnowledgeAdmin(auth);
    if (!file?.buffer?.length) throw new BadRequestException('请选择要入库的文件');
    if (file.size > MAX_KNOWLEDGE_BYTES) {
      throw new BadRequestException(`文件不能超过 ${MAX_KNOWLEDGE_BYTES / 1024 / 1024}MB`);
    }

    const name = decodeUploadFilename(file.originalname);
    const chunks = chunkFile(name, file.buffer);
    if (chunks.length === 0) {
      throw new BadRequestException('没有解析出可入库的内容（支持 .md / .txt / .xlsx，且正文需超过 20 字）');
    }

    const sourcePath = `upload/${name}`;
    this.rag.replaceSource(
      sourcePath,
      chunks.map((chunk, index) => ({
        sourcePath,
        title: name,
        section: chunk.section,
        chunkIndex: index,
        content: chunk.content,
      })),
    );

    return { sourcePath, chunks: chunks.length, totalChunks: this.rag.count() };
  }

  knowledgeDelete(auth: BizAuthContext, sourcePath: string): Record<string, unknown> {
    this.assertKnowledgeAdmin(auth);
    const target = (sourcePath ?? '').trim();
    if (!target) throw new BadRequestException('缺少 sourcePath');
    const removed = this.rag.deleteSource(target);
    if (removed === 0) throw new NotFoundException('没有这个来源');
    return { removed, totalChunks: this.rag.count() };
  }

  private assertKnowledgeAdmin(auth: BizAuthContext): void {
    if (!auth.isSuperAdmin) throw new ForbiddenException('仅超级管理员可维护知识库');
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
    // 来源必须由调用方传入：模型路由来的 forbidden 事件若记成 rule，
    // insights().bySource 会失真（看起来"规则命中率很高"，其实全是模型的功劳）
    source: 'rule' | 'llm' = 'rule',
  ): void {
    if (this.registry.allows(auth, intent)) return;
    const required = intent.authAny?.length ? intent.authAny.join(' 或 ') : String(intent.auth);
    this.flywheel.record({
      userId: auth.userId,
      username: auth.username,
      roleCode: auth.roleCode,
      rawInput: question,
      matchedIntentId: intent.id,
      intentSource: source,
      status: 'forbidden',
      errorCode: `MISSING_PERMISSION:${required}`,
      latencyMs: Date.now() - startedAt,
      traceId,
    });
    throw new ForbiddenException(`当前账号没有使用该功能的权限（需要 ${required}）`);
  }

  /**
   * 规则未命中时的模型路由。
   *
   * 返回的是「可直接给前端的响应」而不是意图对象 —— 因为这里同样可能抛权限/范围错误，
   * 需要落飞轮并转成与规则路径完全一致的错误语义。
   *
   * 任何失败（模型未启用、超时、JSON 坏、工具幻觉、参数不合法）都返回 null，
   * 由调用方回落到功能清单。**模型不是主路，它只是补规则没覆盖的那部分。**
   */
  private async routeWithLlm(
    auth: BizAuthContext,
    question: string,
    traceId: string,
    startedAt: number,
  ): Promise<AiChatResponse | null> {
    if (!this.intentRouter.enabled) return null;

    const outcome = await this.intentRouter.route(auth, question);
    if (!outcome) return null;

    // 双保险：router 内部已按权限过滤过工具清单，这里再按意图声明校验一次
    this.assertPermission(auth, outcome.intent, question, traceId, startedAt, 'llm');

    const cityNames = await this.scopeGuard.cityNames();
    const overrideCity = findCityInInput(question, cityNames) ?? null;

    return this.runIntent(auth, outcome.intent, outcome.params, {
      traceId,
      question,
      startedAt,
      source: 'llm',
      overrideCity,
    });
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
    ctx: { traceId: string; question: string; startedAt: number; source: 'rule' | 'qa' | 'llm'; overrideCity?: string | null },
  ): Promise<AiChatResponse> {
    // 代码处理器：不查只读库，直接调业务服务（目前只有维护台账到期这一类）
    if (!intent.sql && intent.handler) return this.runHandler(auth, intent, params, ctx);

    // 知识库问答：不查业务库，直接用本地片段
    if (!intent.sql) return this.answerKnowledge(auth, intent, params, ctx);

    let scope: ScopePredicate;
    try {
      scope = await this.scopeGuard.resolve(auth, {
        column: intent.sql.scopeColumn,
        valueType: intent.sql.scopeValueType,
      }, ctx.overrideCity);
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
        scopeNotice: scope.notice ?? null,
      }),
    };
  }

  /**
   * 代码处理器执行路径
   *
   * 与 SQL 路径的差别只有一处：结果不是从只读库查出来的，而是业务服务算出来的。
   * 相同的部分：权限在上游已校验、数据范围由业务服务按账号过滤、结果同样落飞轮。
   * 之所以允许这条路径，是因为有些数据的判定必须在应用层做（VARCHAR 脏日期），
   * 硬写成 SQL 会算错，而算错比查不到严重得多。
   */
  private async runHandler(
    auth: BizAuthContext,
    intent: Intent,
    params: IntentParams,
    ctx: { traceId: string; question: string; startedAt: number; source: 'rule' | 'qa' | 'llm'; overrideCity?: string | null },
  ): Promise<AiChatResponse> {
    const kind = intent.handler?.kind;
    if (kind !== 'maintenance_expiry') {
      throw new BadRequestException(`未知的处理器：${kind ?? '(空)'}`);
    }

    // handler 的失败必须和 SQL 路径一样落飞轮。
    // 否则用户说"查不到"时，审计表里只有 ok 记录，运维根本看不出是被权限拦了还是查库炸了。
    let result;
    try {
      result = await this.maintenanceExpiry.run(auth, params, { overrideCity: ctx.overrideCity });
    } catch (error) {
      const forbidden = error instanceof ForbiddenException;
      this.flywheel.record({
        userId: auth.userId,
        username: auth.username,
        roleCode: auth.roleCode,
        rawInput: ctx.question,
        matchedIntentId: intent.id,
        intentSource: ctx.source,
        params,
        status: forbidden ? 'forbidden' : 'error',
        errorCode: forbidden ? 'HANDLER_FORBIDDEN' : 'HANDLER_FAILED',
        latencyMs: Date.now() - ctx.startedAt,
        traceId: ctx.traceId,
      });
      throw error;
    }

    const latencyMs = Date.now() - ctx.startedAt;
    const eventId = this.flywheel.record({
      userId: auth.userId,
      username: auth.username,
      roleCode: auth.roleCode,
      rawInput: ctx.question,
      matchedIntentId: intent.id,
      intentSource: ctx.source,
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
      summary: result.summary,
      chart: result.chart,
      columns: result.table.columns,
      rows: result.table.rows,
      meta: this.meta({
        traceId: ctx.traceId,
        eventId,
        rowCount: result.rowCount,
        latencyMs,
        truncated: result.truncated,
        source: ctx.source,
        // 带上类别，否则前端导出的文件名里只有「本账号可见范围」，几类资产分不清
        scopeLabel: result.scopeLabel,
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
    // 0 命中不能记 ok：insights().matchedRate 用 ok/total 算，把"知识库空手而归"
    // 算成成功会让匹配率虚高，掩盖"文档没入库"这个真问题
    const empty = chunks.length === 0;
    const eventId = this.flywheel.record({
      userId: auth.userId,
      username: auth.username,
      roleCode: auth.roleCode,
      rawInput: ctx.question,
      matchedIntentId: intent.id,
      intentSource: 'qa',
      rowCount: chunks.length,
      latencyMs,
      status: empty ? 'not_matched' : 'ok',
      errorCode: empty ? 'KB_EMPTY' : null,
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

      // 枚举参数的默认值挂在 spec.enum 上，不走 defaultValue.kind 那一套
      if (spec.enum) {
        if (spec.enum.defaultValue) params[name] = spec.enum.defaultValue;
        continue;
      }

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
    ctx: { traceId: string; question: string; startedAt: number; source: 'rule' | 'qa' | 'llm' },
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
    source: 'rule' | 'qa' | 'llm' | 'guide';
    scopeLabel: string;
    scopeNotice?: string | null;
  }): AiChatMeta {
    return {
      traceId: input.traceId,
      eventId: input.eventId,
      rowCount: input.rowCount,
      latencyMs: input.latencyMs,
      truncated: input.truncated,
      intentSource: input.source,
      scopeLabel: input.scopeLabel,
      scopeNotice: input.scopeNotice ?? null,
      llmEnabled: this.llm.status.enabled,
    };
  }
}
