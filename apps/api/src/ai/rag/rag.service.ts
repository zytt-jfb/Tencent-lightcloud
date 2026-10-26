import { Injectable, Logger } from '@nestjs/common';
import Database from 'better-sqlite3';
import { SqliteStore } from '../sql/sqlite.store';
import type { ChunkHit, ChunkInput, VectorBackend } from './vector-backend.interface';

/**
 * FTS5 词法检索实现（当前默认后端）
 *
 * 中文检索的两个坑，这里都处理了：
 *   1. unicode61 分词器按空格切词，中文整句会被当成一个 token → 搜不到。
 *      建表时优先用 trigram（按 3 字符窗口索引），天然支持中文子串；
 *      建表失败才降级 unicode61，并在这里用 LIKE 兜底。
 *   2. trigram 索引对 **少于 3 个字符** 的查询无效（窗口不足），
 *      所以短词（如「口径」）走 LIKE 全表扫描。片段量级在万级以内，扫描代价可接受。
 */
export class FtsLexicalBackend implements VectorBackend {
  private readonly logger = new Logger('AiRagFts');
  private trigram: boolean | null = null;

  constructor(private readonly store: SqliteStore) {}

  private db(): Database.Database {
    return this.store.get();
  }

  private supportsTrigram(db: Database.Database): boolean {
    if (this.trigram !== null) return this.trigram;
    const row = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='chunks_fts'")
      .get() as { sql: string | null } | undefined;
    this.trigram = Boolean(row?.sql && /trigram/i.test(row.sql));
    this.logger.log(`AI_RAG_BACKEND tokenizer=${this.trigram ? 'trigram' : 'unicode61'}`);
    return this.trigram;
  }

  replaceSource(sourcePath: string, items: readonly ChunkInput[]): void {
    const db = this.db();
    const replace = db.transaction((rows: readonly ChunkInput[]) => {
      // 先删 fts 行再删主表：fts 是独立虚表，不随主表删除级联
      db.prepare('DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE source_path = ?)').run(sourcePath);
      db.prepare('DELETE FROM chunks WHERE source_path = ?').run(sourcePath);
      const insertChunk = db.prepare(
        `INSERT INTO chunks (source_path, title, section, chunk_index, content, published_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      const insertFts = db.prepare('INSERT INTO chunks_fts (rowid, content, title) VALUES (?, ?, ?)');
      for (const item of rows) {
        const result = insertChunk.run(
          sourcePath,
          item.title ?? null,
          item.section ?? null,
          item.chunkIndex,
          item.content,
          item.publishedAt ?? null,
        );
        insertFts.run(Number(result.lastInsertRowid), item.content, item.title ?? '');
      }
    });
    replace(items);
  }

  /**
   * 检索
   *
   * 原来的做法是把**整句**用双引号包成 FTS5 短语：`MATCH "后评估的分数到底怎么算"`。
   * trigram 索引下这等价于"要求整句作为连续子串出现"，一个十几字的自然问句
   * 几乎不可能在 1000 字的片段里原样命中 —— 结果是知识库永远返回 0 条，
   * 而使用者会误判成"文档没入库"。
   *
   * 现在改成：先切词元，用 OR 连起来检索（bm25 排序），短词与无 FTS 结果时走 LIKE 兜底。
   */
  search(query: string, topK: number): ChunkHit[] {
    const keyword = query.trim();
    if (!keyword) return [];
    const limit = Math.min(50, Math.max(1, topK));
    const db = this.db();
    const terms = buildTerms(keyword);
    if (terms.length === 0) return [];

    const collected = new Map<number, ChunkHit>();

    // 1) 词元 OR：trigram 只对 >=3 字的查询有效，短词交给下面的 LIKE
    const ftsTerms = terms.filter((term) => term.length >= 3);
    if (ftsTerms.length > 0 && this.supportsTrigram(db)) {
      try {
        const expression = ftsTerms.map((term) => `"${term.replace(/"/g, '""')}"`).join(' OR ');
        const rows = db
          .prepare(
            `SELECT c.id AS id, c.source_path AS source_path, c.title AS title, c.section AS section,
                    c.chunk_index AS chunk_index, c.content AS content, bm25(chunks_fts) AS score
             FROM chunks_fts
             JOIN chunks c ON c.id = chunks_fts.rowid
             WHERE chunks_fts MATCH ?
             ORDER BY score ASC
             LIMIT ?`,
          )
          .all(expression, limit) as FtsRow[];
        for (const row of rows) collected.set(Number(row.id), toHit(row));
      } catch (error) {
        this.logger.warn(`AI_RAG_FTS_QUERY_FAILED fallback=like message=${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // 2) LIKE 兜底：短词、FTS 不可用、或 FTS 召回不足时补齐。
    //    score 给 999 是为了让它们在 bm25 结果之后，而不是插到最前面。
    if (collected.size < limit) {
      const likeTerms = terms.length > 0 ? terms : [keyword];
      const where = likeTerms.map(() => `content LIKE ? ESCAPE '\\'`).join(' OR ');
      const params = likeTerms.map((term) => `%${term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`);
      try {
        const rows = db
          .prepare(
            `SELECT id, source_path, title, section, chunk_index, content, 999 AS score
             FROM chunks WHERE ${where} ORDER BY id DESC LIMIT ?`,
          )
          .all(...params, limit) as FtsRow[];
        for (const row of rows) {
          const id = Number(row.id);
          if (!collected.has(id)) collected.set(id, toHit(row));
        }
      } catch (error) {
        this.logger.warn(`AI_RAG_LIKE_FAILED message=${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return [...collected.values()].sort((a, b) => a.score - b.score).slice(0, limit);
  }

  clear(): void {
    const db = this.db();
    db.exec('DELETE FROM chunks_fts; DELETE FROM chunks;');
  }

  /**
   * 知识库来源清单（给管理界面用）。
   * 按 source_path 聚合是刻意的：一次上传可能切成几十个 chunk，
   * 管理员关心的"我传了哪些文件"，不是"库里有多少碎片"。
   */
  listSources(): Array<{ sourcePath: string; chunks: number; updatedAt: string | null }> {
    const rows = this.db()
      .prepare(
        `SELECT source_path, COUNT(*) AS chunks, MAX(created_at) AS updated_at
         FROM chunks GROUP BY source_path ORDER BY updated_at DESC LIMIT 500`,
      )
      .all() as Array<{ source_path: string; chunks: number; updated_at: string | null }>;
    return rows.map((row) => ({
      sourcePath: row.source_path,
      chunks: Number(row.chunks),
      updatedAt: row.updated_at,
    }));
  }

  /** 删除一个来源的全部片段；返回删掉的片段数（0 表示这个来源本来就不存在） */
  deleteSource(sourcePath: string): number {
    const db = this.db();
    const before = db.prepare('SELECT COUNT(*) AS count FROM chunks WHERE source_path = ?').get(sourcePath) as
      | { count: number }
      | undefined;
    const transaction = db.transaction(() => {
      db.prepare('DELETE FROM chunks_fts WHERE rowid IN (SELECT id FROM chunks WHERE source_path = ?)').run(sourcePath);
      db.prepare('DELETE FROM chunks WHERE source_path = ?').run(sourcePath);
    });
    transaction();
    return Number(before?.count ?? 0);
  }

  count(): number {
    const row = this.db().prepare('SELECT COUNT(*) AS count FROM chunks').get() as { count: number } | undefined;
    return Number(row?.count ?? 0);
  }
}

interface FtsRow {
  id: number;
  source_path: string;
  title: string | null;
  section: string | null;
  chunk_index: number;
  content: string;
  score: number;
}

function toHit(row: FtsRow): ChunkHit {
  return {
    id: Number(row.id),
    sourcePath: row.source_path,
    title: row.title,
    section: row.section,
    chunkIndex: Number(row.chunk_index),
    content: row.content,
    score: Number(row.score),
  };
}

/**
 * RAG 门面
 *
 * 当前消费方式（无 LLM）：命中片段**原样返回**给用户，标注来源文件与章节，
 * 不做任何改写。LLM 合成答案的入口留空，等 ENABLE_LLM=true 时再接。
 */
@Injectable()
export class RagService {
  // 类型用具体实现而不是 VectorBackend：来源清单/删除是 FTS 后端特有的管理能力，
  // 将来换向量后端时需要显式补齐这两个方法，而不是被接口的 optional 掩盖掉。
  private readonly backend: FtsLexicalBackend;

  constructor(store: SqliteStore) {
    this.backend = new FtsLexicalBackend(store);
  }

  search(query: string, topK = 5): ChunkHit[] {
    return this.backend.search(query, topK);
  }

  replaceSource(sourcePath: string, items: readonly ChunkInput[]): void {
    this.backend.replaceSource(sourcePath, items);
  }

  listSources(): Array<{ sourcePath: string; chunks: number; updatedAt: string | null }> {
    return this.backend.listSources();
  }

  deleteSource(sourcePath: string): number {
    return this.backend.deleteSource(sourcePath);
  }

  clear(): void {
    this.backend.clear();
  }

  count(): number {
    return this.backend.count();
  }
}

/**
 * 问句 → 检索词元。
 *
 * 中文没有空格，直接切词不现实，这里做的是「去标点 + 去高频虚词 + 去单字」，
 * 得到 2~8 个短语元交给 OR 检索。宁可多召回再由 bm25 排序，也不要因为
 * 整句不匹配而 0 命中 —— 知识库最大的失败模式是"明明有文档却搜不到"。
 */
const STOP_WORDS = /(的|了|是|吗|呢|吧|啊|呀|请问|帮我|麻烦|一下|怎么|怎样|什么|如何|多少|哪些|哪个|有没有|还有|可以|需要|应该|这个|那个|我们|你们|他们|以及|或者|但是|因为|所以)/g;

export function buildTerms(query: string): string[] {
  const cleaned = query
    .replace(/[，。？！、；：""''（）《》【】,\.\?!;:()\[\]<>|/\\]/g, ' ')
    .replace(STOP_WORDS, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return [];
  const parts = cleaned.split(' ').filter((term) => term.length >= 2);
  const terms = parts.length > 0 ? parts : [cleaned.replace(/\s+/g, '')];
  return [...new Set(terms)].slice(0, 8);
}
