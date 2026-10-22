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

  search(query: string, topK: number): ChunkHit[] {
    const db = this.db();
    const keyword = query.trim();
    if (!keyword) return [];
    const limit = Math.min(50, Math.max(1, topK));

    if (this.supportsTrigram(db) && keyword.length >= 3) {
      try {
        // 用双引号包裹成短语，避免用户输入里的 AND/OR/NEAR 被当成 FTS 语法
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
          .all(`"${keyword.replace(/"/g, '""')}"`, limit) as FtsRow[];
        if (rows.length > 0) return rows.map(toHit);
      } catch (error) {
        this.logger.warn(`AI_RAG_FTS_QUERY_FAILED fallback=like message=${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // 短词 / FTS 语法错误 / trigram 不可用 → LIKE 兜底
    const escaped = keyword.replace(/[\\%_]/g, (ch) => `\\${ch}`);
    const rows = db
      .prepare(
        `SELECT id, source_path, title, section, chunk_index, content, 0 AS score
         FROM chunks
         WHERE content LIKE ? ESCAPE '\\'
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(`%${escaped}%`, limit) as FtsRow[];
    return rows.map(toHit);
  }

  clear(): void {
    const db = this.db();
    db.exec('DELETE FROM chunks_fts; DELETE FROM chunks;');
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
  private readonly backend: VectorBackend;

  constructor(store: SqliteStore) {
    this.backend = new FtsLexicalBackend(store);
  }

  search(query: string, topK = 5): ChunkHit[] {
    return this.backend.search(query, topK);
  }

  replaceSource(sourcePath: string, items: readonly ChunkInput[]): void {
    this.backend.replaceSource(sourcePath, items);
  }

  clear(): void {
    this.backend.clear();
  }

  count(): number {
    return this.backend.count();
  }
}
