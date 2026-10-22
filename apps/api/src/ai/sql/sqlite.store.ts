import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

/**
 * AI 模块本地 sqlite 存储（RAG 片段 / 数据飞轮 / 反馈 共用同一个文件）
 *
 * 为什么三块共用一个文件而不是三个库：
 *   2C2G 机器上每个 Database 实例都要一份页缓存（默认 ~2MB）+ 独立 WAL，
 *   分成三个文件只是徒增句柄与内存；这三块数据都是「AI 侧的旁路数据」，
 *   生命周期一致（一起备份、一起迁移、一起删除），没有分库的理由。
 *
 * 为什么懒打开（第一次 get() 才连）：
 *   AI 是附加能力。sqlite 文件所在目录没有写权限时（例如容器卷属主不对），
 *   如果构造期就打开，整个 API 会启动失败、把主业务一起拖死。
 *   这里把失败推迟到第一个 AI 请求，只让 AI 接口 500/503，主站不受影响。
 */
@Injectable()
export class SqliteStore implements OnModuleDestroy {
  private readonly logger = new Logger(SqliteStore.name);
  private db: Database.Database | null = null;
  private openError: Error | null = null;

  /** 当前 schema 版本；每次加表/加列必须 +1 并在 migrate() 里补分支 */
  static readonly SCHEMA_VERSION = 1;

  constructor(private readonly config: ConfigService) {}

  /** 解析后的库文件绝对路径（日志/自检用） */
  get filePath(): string {
    const configured = (this.config.get<string>('AI_SQLITE_PATH') ?? './data/ai/ai.sqlite').trim();
    return path.resolve(process.cwd(), configured);
  }

  /** 打开状态：ready=可用；error=打开失败的原因（供 /ai/status 暴露给运维） */
  get status(): { ready: boolean; path: string; error: string | null } {
    return { ready: this.db !== null, path: this.filePath, error: this.openError?.message ?? null };
  }

  get(): Database.Database {
    if (this.db) return this.db;
    // 打开失败后不再反复重试：让错误保持稳定，避免每个请求都去打一次失败的 fs 操作
    if (this.openError) throw this.openError;

    try {
      const file = this.filePath;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const db = new Database(file);
      // WAL：读写不互相阻塞；本模块是「多读少写」（检索多、落日志写），WAL 比默认 rollback journal 合适。
      db.pragma('journal_mode = WAL');
      // 单写者模型：better-sqlite3 是同步 API，并发写在同一进程内天然串行；
      // busy_timeout 只为了防御「外部脚本（rag.ingest）正在写」这种跨进程场景。
      db.pragma('busy_timeout = 5000');
      db.pragma('synchronous = NORMAL');
      this.migrate(db);
      this.db = db;
      this.logger.log(`AI_SQLITE_READY path=${file} schema=${SqliteStore.SCHEMA_VERSION}`);
      return db;
    } catch (error) {
      this.openError = error instanceof Error ? error : new Error(String(error));
      this.logger.error(`AI_SQLITE_OPEN_FAILED path=${this.filePath} message=${this.openError.message}`);
      throw this.openError;
    }
  }

  /**
   * 建表（幂等）。
   * 表结构变更策略：这里只做「IF NOT EXISTS 追加」，不做破坏性 ALTER；
   * 真要改列就加新表 + 版本号，老数据保留可读。
   */
  private migrate(db: Database.Database): void {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      /* RAG 片段：一份历史报告切成 N 段，source_path + chunk_index 唯一 */
      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_path TEXT NOT NULL,
        title TEXT,
        section TEXT,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        published_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE (source_path, chunk_index)
      );

      /* 数据飞轮：一次问答一行。既是审计日志，也是将来做微调的语料来源 */
      CREATE TABLE IF NOT EXISTS ai_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts TEXT NOT NULL,
        user_id TEXT NOT NULL,
        username TEXT,
        role_code TEXT,
        raw_input TEXT,
        normalized_input TEXT,
        matched_intent_id TEXT,
        intent_source TEXT NOT NULL DEFAULT 'rule',
        sql_text TEXT,
        param_json TEXT,
        row_count INTEGER,
        latency_ms INTEGER,
        status TEXT NOT NULL DEFAULT 'ok',
        error_code TEXT,
        trace_id TEXT,
        feedback TEXT,
        feedback_note TEXT,
        feedback_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_ai_events_ts ON ai_events (ts);
      CREATE INDEX IF NOT EXISTS idx_ai_events_intent ON ai_events (matched_intent_id);
      CREATE INDEX IF NOT EXISTS idx_ai_events_status ON ai_events (status);
    `);

    // 全文索引单独建：FTS5 的 tokenizer 在不同 SQLite 编译选项下支持程度不同，
    // 失败时降级为 unicode61（中文检索会变差但不影响启动），由 rebuild 保证后续可换。
    const hasFts = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='chunks_fts'",
    ).get();
    if (!hasFts) {
      try {
        // trigram：中文没有空格，unicode61 会把整句当一个 token（等于搜不到）；
        // trigram 按 3 字符窗口建索引，天然支持中文子串匹配。
        db.exec("CREATE VIRTUAL TABLE chunks_fts USING fts5(content, title, tokenize='trigram')");
      } catch (error) {
        this.logger.warn(
          `AI_FTS_TRIGRAM_UNAVAILABLE fallback=unicode61 message=${error instanceof Error ? error.message : String(error)}`,
        );
        db.exec('CREATE VIRTUAL TABLE chunks_fts USING fts5(content, title)');
      }
    }

    const current = db.prepare('SELECT MAX(version) AS version FROM ai_schema_version').get() as
      | { version: number | null }
      | undefined;
    if (!current?.version) {
      db.prepare('INSERT INTO ai_schema_version (version) VALUES (?)').run(SqliteStore.SCHEMA_VERSION);
    }
  }

  onModuleDestroy(): void {
    // 必须显式关闭：WAL 模式下不 close 会留下 -wal/-shm，下次打开需要恢复
    try {
      this.db?.close();
    } catch {
      /* 关闭失败不影响进程退出 */
    }
    this.db = null;
  }
}
