/**
 * 检索后端抽象
 *
 * 为什么现在就要定这层接口，而不是「以后再说」：
 *   当前用 SQLite FTS5 做词法检索（lexical）完全够用，且没有 embedding 依赖；
 *   但将来接 sqlite-vec 时，如果 rag.service 里到处是 `chunks_fts MATCH`，
 *   换后端就得改业务代码。把「写入/查询/清空」三个动作抽出来，
 *   将来只加一个 SqliteVecBackend 实现、改一行工厂，其余不动。
 */

export interface ChunkInput {
  /** 来源文件（相对路径），同一来源重复摄入会整体替换 */
  sourcePath: string;
  title?: string | null;
  /** 章节标题（按 md 标题/Excel sheet 名切分时写入） */
  section?: string | null;
  chunkIndex: number;
  content: string;
  publishedAt?: string | null;
}

export interface ChunkHit {
  id: number;
  sourcePath: string;
  title: string | null;
  section: string | null;
  chunkIndex: number;
  content: string;
  /** 相关度：越小越相关（FTS5 bm25 的口径）；向量后端可用 1-余弦相似度 对齐 */
  score: number;
}

export interface VectorBackend {
  /** 全量替换一个来源的所有片段（幂等：重复摄入不会产生重复行） */
  replaceSource(sourcePath: string, items: readonly ChunkInput[]): void;
  search(query: string, topK: number): ChunkHit[];
  clear(): void;
  count(): number;
}
