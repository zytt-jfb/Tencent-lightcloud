import { Injectable, Logger } from '@nestjs/common';
import type { BizAuthContext } from '../../rbac/rbac.service';
import { INTENT_CATALOG } from './catalog';
import { deriveParamNames, normalizeInput } from './intent-params';
import type { GuideItem, Intent, IntentMatch } from './intent.types';
import {
  assertLimit,
  assertScopePlaceholder,
  assertSelectOnly,
  assertSingleStatement,
  assertTablesAllowed,
  countPlaceholders,
} from '../sql/sql-guard';

/** 启动期静态校验允许的最大 LIMIT（执行期还会按 AI_MAX_ROWS 再校验一次） */
const STATIC_MAX_ROWS = 500;

interface RejectedIntent {
  id: string;
  reason: string;
}

/**
 * 意图注册表
 *
 * 三个关键决定：
 *   1. **同步构建、无 IO**：目录是代码常量，不需要读文件/查库，因此可以在 Nest 构造期完成，
 *      第一次请求就能匹配，不存在「注册表还没加载完」的窗口。
 *   2. **坏意图只剔除、不阻断启动**：模板写错（表名不在白名单、少了 LIMIT）会记 error 日志并从注册表移除，
 *      通过 /ai/status 暴露给运维。如果让它抛异常，一个模板笔误就会让整个 API 起不来 ——
 *      AI 是附加能力，不该有这种权力。
 *   3. **同义词提升为全局表**：意图级 synonyms 在构建时合并，避免「同一个词在 A 意图能归一、在 B 意图不能」。
 */
@Injectable()
export class IntentRegistry {
  private readonly logger = new Logger(IntentRegistry.name);
  private intents: readonly Intent[] = [];
  private rejected: RejectedIntent[] = [];
  private synonyms: Record<string, string> = {};

  constructor() {
    this.reload();
  }

  get all(): readonly Intent[] {
    return this.intents;
  }

  get rejectedIntents(): readonly RejectedIntent[] {
    return this.rejected;
  }

  /** 重新加载（当前是常量目录，只用于测试与将来接 JSON 覆盖） */
  reload(extra: readonly Intent[] = []): void {
    const candidates = [...INTENT_CATALOG, ...extra];
    const seen = new Set<string>();
    const valid: Intent[] = [];
    const rejected: RejectedIntent[] = [];
    const synonyms: Record<string, string> = {};

    for (const intent of candidates) {
      const reason = this.validate(intent, seen);
      if (reason) {
        rejected.push({ id: intent.id ?? '(no-id)', reason });
        this.logger.error(`AI_INTENT_REJECTED id=${intent.id} reason=${reason}`);
        continue;
      }
      seen.add(intent.id);
      valid.push(intent);
      Object.assign(synonyms, intent.synonyms ?? {});
    }

    this.intents = valid;
    this.rejected = rejected;
    this.synonyms = synonyms;
    this.logger.log(`AI_INTENT_REGISTRY_READY intents=${valid.length} rejected=${rejected.length}`);
  }

  /**
   * 静态校验：返回 null 表示通过。
   * 这里不校验「结果字段是否存在」——那取决于真实 SQL 结果，只能在运行时用兜底字符处理。
   */
  private validate(intent: Intent, seen: Set<string>): string | null {
    if (!intent.id) return '缺少 id';
    if (seen.has(intent.id)) return `id 重复：${intent.id}`;
    if (!intent.triggers?.length) return '缺少 triggers';
    if (!intent.summary) return '缺少 summary';
    if (intent.triggers.some((trigger) => trigger.trim().length < 2)) return 'trigger 长度必须 >= 2';

    if (!intent.sql) {
      if (intent.category !== 'qa') return '非 qa 意图必须提供 sql';
      return null;
    }
    try {
      const sql = assertSingleStatement(intent.sql.text);
      assertSelectOnly(sql);
      assertTablesAllowed(sql);
      assertLimit(sql, STATIC_MAX_ROWS);
      assertScopePlaceholder(sql);
      if (!intent.sql.scopeColumn) return 'sql 缺少 scopeColumn';
      if (!['city_id', 'city_name'].includes(intent.sql.scopeValueType)) return 'scopeValueType 非法';
      // 参数顺序契约：SQL 里（除 {{scope}} 之外的）占位符个数必须等于推导出的参数个数
      const arity = countPlaceholders(sql.replace('{{scope}}', ''));
      const derived = deriveParamNames(intent);
      if (arity !== derived.length) {
        return `SQL 占位符 ${arity} 个，但参数声明推导出 ${derived.length} 个（${derived.join(',')}）`;
      }
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    return null;
  }

  normalize(input: string): string {
    return normalizeInput(input, this.synonyms);
  }

  byId(id: string): Intent | undefined {
    return this.intents.find((intent) => intent.id === id);
  }

  /**
   * 匹配：先匹配业务意图，全部未命中才考虑 qa 兜底。
   * 为什么分两轮：qa 的触发词是「怎么算/办法/口径」这类泛词，
   * 和业务意图一起打分时会把「后评估排名怎么算」误判成知识库问答。
   */
  match(rawInput: string): IntentMatch | null {
    const normalized = this.normalize(rawInput);
    const business = this.bestMatch(normalized, (intent) => intent.category !== 'qa');
    if (business) return business;
    return this.bestMatch(normalized, (intent) => intent.category === 'qa');
  }

  private bestMatch(normalized: string, filter: (intent: Intent) => boolean): IntentMatch | null {
    let best: { intent: Intent; hits: string[]; score: number } | null = null;
    for (const intent of this.intents) {
      if (!filter(intent)) continue;
      // 触发词也做一次归一化：目录里同时写了「排行」和「排名」，用户输入被归一后要能对上「排名」那条
      const hits = intent.triggers.filter((trigger) => normalized.includes(trigger.toLowerCase()));
      if (hits.length === 0) continue;
      const longest = hits.reduce((max, hit) => Math.max(max, hit.length), 0);
      // 打分：优先级优先（*100），其次最长命中词（越具体越可信），再其次命中数量
      const score = (intent.priority ?? 0) * 100 + longest * 10 + hits.length;
      if (!best || score > best.score) best = { intent, hits, score };
    }
    return best ? { intent: best.intent, matchedTriggers: best.hits, normalized } : null;
  }

  /** 未命中时的引导清单：只列出当前账号有权使用的意图（无权限的不展示，避免点了 403） */
  guideFor(auth: Pick<BizAuthContext, 'permissionCodes' | 'isSuperAdmin'>): GuideItem[] {
    return this.intents
      .filter((intent) => !intent.auth || auth.isSuperAdmin || auth.permissionCodes.has(intent.auth))
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))
      .map((intent) => ({
        id: intent.id,
        name: intent.name,
        category: intent.category,
        examples: intent.examples ?? [],
      }));
  }
}
