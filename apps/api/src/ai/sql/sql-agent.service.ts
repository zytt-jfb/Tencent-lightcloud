import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AI_SEMAPHORE_TOKEN, Semaphore } from '../concurrency/semaphore';
import { ReadonlyDataSource, type SqlParam } from './readonly-datasource';
import { guardSql } from './sql-guard';

export interface SqlAgentResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  /** 是否可能被 LIMIT 截断（等于 limit 就提示用户「还有更多」） */
  truncated: boolean;
  /** 实际执行的 SQL（写进飞轮做审计） */
  sql: string;
  latencyMs: number;
}

/**
 * SQL 执行器
 *
 * 职责边界很窄：**只做护栏 + 限流 + 执行**，不做业务判断、不改写 SQL。
 * SQL 从哪来说到底是 intent 模板拼出来的，这个类不相信调用方。
 *
 * 顺序刻意是「先护栏、后抢名额」：护栏是纯 CPU 操作（微秒级），
 * 让它失败在最前面，就不会出现「非法 SQL 占着并发名额」。
 */
@Injectable()
export class SqlAgentService {
  private readonly logger = new Logger(SqlAgentService.name);

  constructor(
    private readonly readonlyDb: ReadonlyDataSource,
    @Inject(AI_SEMAPHORE_TOKEN) private readonly semaphore: Semaphore,
    private readonly config: ConfigService,
  ) {}

  /** 单次查询最大行数：默认 500，夹在 10~2000（2C2G 上再大就容易把内存打满） */
  get maxRows(): number {
    const raw = Number.parseInt(String(this.config.get<string>('AI_MAX_ROWS') ?? ''), 10);
    if (!Number.isFinite(raw)) return 500;
    return Math.min(2000, Math.max(10, raw));
  }

  async execute(input: { sql: string; params: readonly SqlParam[]; timeoutMs?: number }): Promise<SqlAgentResult> {
    const maxRows = this.maxRows;
    // 护栏在抢名额之前：非法/超限的 SQL 直接抛，不占用并发
    const guarded = guardSql({ sql: input.sql, params: input.params, maxRows });

    const release = await this.semaphore.acquire();
    const startedAt = Date.now();
    try {
      const result = await this.readonlyDb.query(guarded.sql, input.params, input.timeoutMs ?? 5_000);
      const latencyMs = Date.now() - startedAt;
      return {
        rows: result.rows,
        rowCount: result.rowCount,
        truncated: result.rowCount >= guarded.limit,
        sql: guarded.sql,
        latencyMs,
      };
    } catch (error) {
      this.logger.warn(
        `AI_SQL_FAILED latencyMs=${Date.now() - startedAt} tables=${guarded.tables.join(',')} message=${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    } finally {
      release();
    }
  }
}
