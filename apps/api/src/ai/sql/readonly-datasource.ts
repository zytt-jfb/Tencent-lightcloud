import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import mysql, { type Pool } from 'mysql2/promise';
import type { ExecuteValues } from 'mysql2/typings/mysql/lib/protocol/sequences/Query';

/** 允许出现在 SQL 参数里的标量类型（与 mysql2 的 ExecuteValues 对齐，禁止把对象/数组直接塞进参数） */
export type SqlParam = string | number | bigint | boolean | Date | null | Buffer;

/**
 * 「AI 未配置」与「AI 查询失败」要能被上层区分：
 *   - 未配置（READONLY_DSN 为空）：返回 503 + 明确提示，不是程序 bug
 *   - 查询失败（连接断开/SQL 错）：500 + 错误码，便于排查
 * 两者混成一个 Error 的话，运维只能看日志猜。
 */
export class ReadonlyUnavailableError extends Error {
  constructor(message: string, readonly code: 'NOT_CONFIGURED' | 'CONNECT_FAILED' = 'NOT_CONFIGURED') {
    super(message);
    this.name = 'ReadonlyUnavailableError';
  }
}

export interface ReadonlyQueryResult {
  rows: Array<Record<string, unknown>>;
  rowCount: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;
/** 2C2G 机器上给 AI 的连接数上限：主业务连接池已经吃掉 10，这里只留 2 */
const MAX_POOL_SIZE = 2;

/**
 * 业务库只读连接（独立于 TypeORM 主数据源）
 *
 * 为什么不用 TypeORM 的 DataSource：
 *   主数据源用的是 DB_USERNAME（有写权限）。用它执行 AI 生成/模板化的 SQL，
 *   护栏一旦有漏洞就是生产写操作。这里单独用一个只有 SELECT 权限的账号，
 *   即使护栏被绕过，DB 层也会拒绝 —— 这是「纵深防御」的第二道闸。
 *
 * 为什么懒初始化：
 *   READONLY_DSN 缺失时不能让 API 启动失败（AI 是附加能力，不能拖垮主站）。
 */
@Injectable()
export class ReadonlyDataSource implements OnModuleDestroy {
  private readonly logger = new Logger(ReadonlyDataSource.name);
  private pool: Pool | null = null;
  private initError: string | null = null;

  constructor(private readonly config: ConfigService) {}

  get configured(): boolean {
    return Boolean(this.dsn());
  }

  get status(): { configured: boolean; ready: boolean; error: string | null; poolSize: number } {
    return {
      configured: this.configured,
      ready: this.pool !== null,
      error: this.initError,
      poolSize: MAX_POOL_SIZE,
    };
  }

  private dsn(): string {
    return (this.config.get<string>('READONLY_DSN') ?? '').trim();
  }

  /**
   * DSN 形如 mysql://ai_ro:password@mysql:3306/biz_restore_20261015
   * 注意：密码里若含 @ : / 等字符，必须在此处做 URL 编码，否则会被解析错。
   */
  private parseDsn(dsn: string): {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  } {
    let url: URL;
    try {
      url = new URL(dsn);
    } catch {
      throw new ReadonlyUnavailableError('READONLY_DSN 格式非法，应为 mysql://user:pass@host:port/database');
    }
    const database = url.pathname.replace(/^\//, '');
    if (!url.hostname || !database) {
      throw new ReadonlyUnavailableError('READONLY_DSN 缺少主机或库名');
    }
    return {
      host: url.hostname,
      port: Number(url.port || 3306),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database,
    };
  }

  private ensurePool(): Pool {
    if (this.pool) return this.pool;
    const dsn = this.dsn();
    if (!dsn) throw new ReadonlyUnavailableError('AI 只读数据源未配置（READONLY_DSN 为空）', 'NOT_CONFIGURED');
    if (this.initError) throw new ReadonlyUnavailableError(this.initError, 'CONNECT_FAILED');

    const parsed = this.parseDsn(dsn);
    try {
      this.pool = mysql.createPool({
        ...parsed,
        connectionLimit: MAX_POOL_SIZE,
        waitForConnections: true,
        queueLimit: 0,
        connectTimeout: 5_000,
        // 关掉多语句：即使 SQL 字符串里被塞了分号，驱动层也不会执行第二条
        multipleStatements: false,
        // DECIMAL/BIGINT 以字符串返回（避免 JS number 精度丢失），转数字由 report 层统一处理
        supportBigNumbers: true,
        bigNumberStrings: true,
        // 日期以字符串返回，避免驱动按 Node 时区做一次隐式转换（DB 与容器都是 Asia/Shanghai）
        dateStrings: true,
        charset: 'utf8mb4',
      });
      this.initError = null;
      this.logger.log(`AI_READONLY_POOL_READY host=${parsed.host} database=${parsed.database} pool=${MAX_POOL_SIZE}`);
      return this.pool;
    } catch (error) {
      this.initError = error instanceof Error ? error.message : String(error);
      this.pool = null;
      throw new ReadonlyUnavailableError(`AI 只读连接创建失败：${this.initError}`, 'CONNECT_FAILED');
    }
  }

  /**
   * 执行参数化查询。
   * 用 execute（服务端预编译）而不是 query（客户端拼接）：参数永远不会进入 SQL 文本。
   * timeout 由驱动在协议层计时，避免慢 SQL 把 2 个连接全占死。
   */
  async query(
    sql: string,
    params: readonly SqlParam[] = [],
    timeoutMs = DEFAULT_TIMEOUT_MS,
  ): Promise<ReadonlyQueryResult> {
    const pool = this.ensurePool();
    try {
      const [rows] = await pool.execute({ sql, timeout: timeoutMs }, params as ExecuteValues[]);
      const list = Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
      return { rows: list, rowCount: list.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // 连接类错误清空 pool，下次请求重建；SQL 语法错则保留 pool（重建也没用）
      if (/ECONNREFUSED|ETIMEDOUT|PROTOCOL_CONNECTION_LOST|Access denied/i.test(message)) {
        this.initError = message;
        void pool.end().catch(() => undefined);
        this.pool = null;
        throw new ReadonlyUnavailableError(`AI 只读连接不可用：${message}`, 'CONNECT_FAILED');
      }
      throw error;
    }
  }

  /** 供健康检查/自检使用；不抛错 */
  async ping(): Promise<{ ok: boolean; message: string }> {
    if (!this.configured) return { ok: false, message: 'READONLY_DSN 未配置' };
    try {
      await this.query('SELECT 1 AS ok', [], 2_000);
      return { ok: true, message: 'ok' };
    } catch (error) {
      return { ok: false, message: error instanceof Error ? error.message : String(error) };
    }
  }

  async onModuleDestroy(): Promise<void> {
    const pool = this.pool;
    this.pool = null;
    await pool?.end().catch(() => undefined);
  }
}
