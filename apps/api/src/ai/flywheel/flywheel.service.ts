import { Injectable, Logger } from '@nestjs/common';
import type { BizAuthContext } from '../../rbac/rbac.service';
import { SqliteStore } from '../sql/sqlite.store';

export type AiEventStatus = 'ok' | 'not_matched' | 'missing_param' | 'forbidden' | 'unconfigured' | 'error';
export type AiIntentSource = 'rule' | 'qa' | 'guide' | 'llm' | 'manual';
export type AiFeedback = 'up' | 'down';

export interface AiEventInput {
  userId: string;
  username?: string | null;
  roleCode?: string | null;
  rawInput: string;
  normalizedInput?: string | null;
  matchedIntentId?: string | null;
  intentSource: AiIntentSource;
  sqlText?: string | null;
  params?: unknown;
  rowCount?: number | null;
  latencyMs?: number | null;
  status: AiEventStatus;
  errorCode?: string | null;
  traceId?: string | null;
}

export interface AiEventRow {
  id: number;
  ts: string;
  user_id: string;
  username: string | null;
  matched_intent_id: string | null;
  intent_source: string;
  raw_input: string | null;
  row_count: number | null;
  latency_ms: number | null;
  status: string;
  feedback: string | null;
}

/** 手机号 / 身份证 / 邮箱脱敏：飞轮要留「用户到底问了什么」才能用于学习，但不该留明文个人标识 */
export function maskPii(input: string): string {
  return input
    .replace(/\b1[3-9]\d{9}\b/g, (value) => `${value.slice(0, 3)}****${value.slice(-4)}`)
    .replace(/\b\d{17}[\dXx]\b/g, (value) => `${value.slice(0, 6)}********${value.slice(-2)}`)
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, (value) => {
      const [name, domain] = value.split('@');
      return `${name.slice(0, 1)}***@${domain}`;
    });
}

/**
 * 数据飞轮（审计 + 未来训练的语料来源）
 *
 * 三条设计取舍：
 *   1. **写失败绝不影响用户拿结果**：记日志本身是旁路，它挂了不该让查询返回 500。
 *   2. **同步写**：better-sqlite3 是同步驱动，单行插入亚毫秒级；改成异步反而要处理队列与丢失。
 *   3. **字段脱敏但保留原句**：只替换手机号/身份证/邮箱这类强标识，保留问句语义，
 *      否则以后拿这批语料训练等于垃圾进垃圾出。
 */
@Injectable()
export class FlywheelService {
  private readonly logger = new Logger(FlywheelService.name);

  constructor(private readonly sqlite: SqliteStore) {}

  record(input: AiEventInput): number | null {
    try {
      const db = this.sqlite.get();
      const result = db
        .prepare(
          `INSERT INTO ai_events (
             ts, user_id, username, role_code, raw_input, normalized_input,
             matched_intent_id, intent_source, sql_text, param_json, row_count,
             latency_ms, status, error_code, trace_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          new Date().toISOString(),
          input.userId,
          input.username ?? null,
          input.roleCode ?? null,
          maskPii(input.rawInput ?? ''),
          input.normalizedInput ? maskPii(input.normalizedInput) : null,
          input.matchedIntentId ?? null,
          input.intentSource,
          input.sqlText ?? null,
          input.params ? JSON.stringify(input.params) : null,
          input.rowCount ?? null,
          input.latencyMs ?? null,
          input.status,
          input.errorCode ?? null,
          input.traceId ?? null,
        );
      return Number(result.lastInsertRowid);
    } catch (error) {
      // 只 warn：飞轮写失败不能把用户的查询结果弄丢
      this.logger.warn(`AI_FLYWHEEL_WRITE_FAILED message=${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * 反馈。只允许给「自己的」事件打标：event.user_id 必须等于当前账号。
   * 不做这个校验的话，任何人遍历 id 就能篡改别人的反馈，语料就脏了。
   */
  setFeedback(auth: BizAuthContext, eventId: number, feedback: AiFeedback, note?: string | null): boolean {
    try {
      const db = this.sqlite.get();
      const row = db.prepare('SELECT id FROM ai_events WHERE id = ? AND user_id = ?').get(eventId, auth.userId) as
        | { id: number }
        | undefined;
      if (!row) return false;
      db.prepare('UPDATE ai_events SET feedback = ?, feedback_note = ?, feedback_at = ? WHERE id = ?').run(
        feedback,
        note ? maskPii(note).slice(0, 500) : null,
        new Date().toISOString(),
        eventId,
      );
      return true;
    } catch (error) {
      this.logger.warn(`AI_FLYWHEEL_FEEDBACK_FAILED message=${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /** 运营视角的粗略统计（不做复杂 BI，够看趋势就行） */
  stats(days = 7): {
    total: number;
    matched: number;
    notMatched: number;
    avgLatencyMs: number;
    topIntents: Array<{ intentId: string; count: number }>;
  } {
    try {
      const db = this.sqlite.get();
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const base = db
        .prepare(
          `SELECT
             COUNT(*) AS total,
             SUM(CASE WHEN matched_intent_id IS NOT NULL THEN 1 ELSE 0 END) AS matched,
             SUM(CASE WHEN status = 'not_matched' THEN 1 ELSE 0 END) AS not_matched,
             AVG(latency_ms) AS avg_latency
           FROM ai_events WHERE ts >= ?`,
        )
        .get(since) as Record<string, unknown> | undefined;
      const top = db
        .prepare(
          `SELECT matched_intent_id AS intent_id, COUNT(*) AS count
           FROM ai_events
           WHERE ts >= ? AND matched_intent_id IS NOT NULL
           GROUP BY matched_intent_id ORDER BY count DESC LIMIT 10`,
        )
        .all(since) as Array<{ intent_id: string; count: number }>;
      return {
        total: Number(base?.total ?? 0),
        matched: Number(base?.matched ?? 0),
        notMatched: Number(base?.not_matched ?? 0),
        avgLatencyMs: Math.round(Number(base?.avg_latency ?? 0)),
        topIntents: top.map((row) => ({ intentId: row.intent_id, count: Number(row.count) })),
      };
    } catch {
      return { total: 0, matched: 0, notMatched: 0, avgLatencyMs: 0, topIntents: [] };
    }
  }

  /**
   * 运营洞察：飞轮真正产生价值的地方。
   *
   * 光记日志没用，得能回答三个问题：
   *   1. 用户问了什么但没答上来（notMatchedTop）→ 决定补哪些关键词/工具；
   *   2. 哪类失败最多（byStatus / errorTop）→ 决定修哪条链路；
   *   3. 规则和大模型各自扛了多少（bySource）→ 决定模型值不值得继续开。
   *
   * 未命中问句按原文聚合计数：重复出现的才是真需求，偶发一次的多半是误触。
   */
  insights(days = 30): {
    windowDays: number;
    total: number;
    matchedRate: number;
    byStatus: Array<{ status: string; count: number }>;
    bySource: Array<{ source: string; count: number }>;
    notMatchedTop: Array<{ input: string; count: number; lastTs: string }>;
    errorTop: Array<{ code: string; count: number }>;
    feedback: { up: number; down: number; rate: number };
  } {
    const empty = {
      windowDays: days,
      total: 0,
      matchedRate: 0,
      byStatus: [],
      bySource: [],
      notMatchedTop: [],
      errorTop: [],
      feedback: { up: 0, down: 0, rate: 0 },
    };
    try {
      const db = this.sqlite.get();
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const group = (column: string): Array<{ key: string | null; count: number }> =>
        db
          .prepare(`SELECT ${column} AS key, COUNT(*) AS count FROM ai_events WHERE ts >= ? GROUP BY ${column} ORDER BY count DESC`)
          .all(since) as Array<{ key: string | null; count: number }>;

      const status = group('status');
      const source = group('intent_source');
      const total = status.reduce((sum, row) => sum + Number(row.count), 0);
      const okCount = Number(status.find((row) => row.key === 'ok')?.count ?? 0);

      const notMatched = db
        .prepare(
          `SELECT raw_input AS input, COUNT(*) AS count, MAX(ts) AS last_ts
           FROM ai_events
           WHERE ts >= ? AND status = 'not_matched' AND raw_input IS NOT NULL AND TRIM(raw_input) <> ''
           GROUP BY raw_input ORDER BY count DESC, last_ts DESC LIMIT 30`,
        )
        .all(since) as Array<{ input: string; count: number; last_ts: string }>;

      const errors = db
        .prepare(
          `SELECT error_code AS code, COUNT(*) AS count
           FROM ai_events
           WHERE ts >= ? AND error_code IS NOT NULL AND error_code <> ''
           GROUP BY error_code ORDER BY count DESC LIMIT 20`,
        )
        .all(since) as Array<{ code: string; count: number }>;

      const votes = db
        .prepare(
          `SELECT feedback AS key, COUNT(*) AS count
           FROM ai_events WHERE ts >= ? AND feedback IS NOT NULL GROUP BY feedback`,
        )
        .all(since) as Array<{ key: string | null; count: number }>;
      const up = Number(votes.find((row) => row.key === 'up')?.count ?? 0);
      const down = Number(votes.find((row) => row.key === 'down')?.count ?? 0);

      return {
        windowDays: days,
        total,
        matchedRate: total > 0 ? Math.round((okCount / total) * 1000) / 10 : 0,
        byStatus: status.map((row) => ({ status: row.key ?? '(空)', count: Number(row.count) })),
        bySource: source.map((row) => ({ source: row.key ?? '(空)', count: Number(row.count) })),
        notMatchedTop: notMatched.map((row) => ({ input: row.input, count: Number(row.count), lastTs: row.last_ts })),
        errorTop: errors.map((row) => ({ code: row.code, count: Number(row.count) })),
        feedback: { up, down, rate: up + down > 0 ? Math.round((up / (up + down)) * 1000) / 10 : 0 },
      };
    } catch (error) {
      this.logger.warn(`AI_FLYWHEEL_INSIGHTS_FAILED message=${error instanceof Error ? error.message : String(error)}`);
      return empty;
    }
  }

  recent(limit = 20): AiEventRow[] {
    try {
      const db = this.sqlite.get();
      return db
        .prepare(
          `SELECT id, ts, user_id, username, matched_intent_id, intent_source, raw_input, row_count, latency_ms, status, feedback
           FROM ai_events ORDER BY id DESC LIMIT ?`,
        )
        .all(Math.min(200, Math.max(1, limit))) as AiEventRow[];
    } catch {
      return [];
    }
  }
}
