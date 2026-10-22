import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import type { ConfigService } from '@nestjs/config';
import { SqliteStore } from '../sql/sqlite.store';
import { FtsLexicalBackend } from './rag.service';
import type { ChunkInput } from './vector-backend.interface';

/**
 * RAG 摄入脚本（手动运行，不进服务进程）
 *
 * 用法（编译后）：
 *   node dist/ai/rag/rag.ingest.js --dir ../../docs
 *   node dist/ai/rag/rag.ingest.js --dir ../../docs --clear
 *   node dist/ai/rag/rag.ingest.js --dir ./reports --dry-run
 *
 * 为什么是独立脚本而不是接口：
 *   摄入要读磁盘、解析 Excel、算几十秒，放进 API 进程会占住 2C2G 的内存与事件循环。
 *   运维在低峰期手动跑一次即可，Nest 侧只负责查询。
 *
 * 为什么写同一个 sqlite 文件：
 *   与服务共用 schema（chunks / chunks_fts），靠 WAL + busy_timeout 容忍并发读。
 *   写入时对每个来源做「整体替换」，重复跑不会产生重复片段。
 */

interface IngestOptions {
  dir: string;
  clear: boolean;
  dryRun: boolean;
}

function parseArgs(argv: string[]): IngestOptions {
  const options: IngestOptions = { dir: '', clear: false, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--clear') options.clear = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--dir') options.dir = argv[i + 1] ?? '';
    else if (arg.startsWith('--dir=')) options.dir = arg.slice('--dir='.length);
  }
  return options;
}

const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt']);
const SHEET_EXTENSIONS = new Set(['.xlsx', '.xls']);

function collectFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const ext = path.extname(entry.name).toLowerCase();
        if (TEXT_EXTENSIONS.has(ext) || SHEET_EXTENSIONS.has(ext)) out.push(full);
      }
    }
  };
  walk(root);
  return out.sort();
}

/** 单段最大字符数：太大检索不精准，太小上下文断裂；800~1200 是经验区间 */
const MAX_CHUNK_CHARS = 1000;

/**
 * 文本切分：优先按二级标题（##），没有标题时按空行分段，再按长度合并/拆分。
 * 每个片段保留 section，回答时可以标注「出自《XX》第几节」。
 */
export function splitText(text: string): Array<{ section: string | null; content: string }> {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const sections: Array<{ section: string | null; body: string }> = [];
  const lines = normalized.split('\n');
  let currentSection: string | null = null;
  let buffer: string[] = [];

  const flush = (): void => {
    const body = buffer.join('\n').trim();
    if (body) sections.push({ section: currentSection, body });
    buffer = [];
  };

  for (const line of lines) {
    const heading = /^#{1,3}\s+(.+)$/.exec(line);
    if (heading) {
      flush();
      currentSection = heading[1].trim();
      continue;
    }
    buffer.push(line);
  }
  flush();

  const chunks: Array<{ section: string | null; content: string }> = [];
  for (const section of sections) {
    if (section.body.length <= MAX_CHUNK_CHARS) {
      chunks.push({ section: section.section, content: section.body });
      continue;
    }
    // 超长段落按空行再切，仍超长就硬切（保证每段都有内容，不丢信息）
    for (const piece of section.body.split(/\n{2,}/)) {
      const trimmed = piece.trim();
      if (!trimmed) continue;
      if (trimmed.length <= MAX_CHUNK_CHARS) {
        chunks.push({ section: section.section, content: trimmed });
        continue;
      }
      for (let offset = 0; offset < trimmed.length; offset += MAX_CHUNK_CHARS) {
        chunks.push({ section: section.section, content: trimmed.slice(offset, offset + MAX_CHUNK_CHARS) });
      }
    }
  }
  return chunks.filter((chunk) => chunk.content.trim().length > 20);
}

/** Excel → 文本：每个 sheet 一段（首行为表头，每 40 行一组，避免一个 sheet 变成巨型片段） */
export function sheetToChunks(filePath: string): Array<{ section: string | null; content: string }> {
  const workbook = XLSX.readFile(filePath);
  const chunks: Array<{ section: string | null; content: string }> = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Array<string | number | null>>(sheet, { header: 1, blankrows: false });
    if (rows.length === 0) continue;
    const header = (rows[0] ?? []).map((cell) => String(cell ?? '').trim());
    for (let start = 1; start < rows.length; start += 40) {
      const lines: string[] = [];
      for (const row of rows.slice(start, start + 40)) {
        const pairs = row
          .map((cell, index) => (cell === null || cell === undefined || cell === '' ? null : `${header[index] || `列${index + 1}`}: ${cell}`))
          .filter(Boolean);
        if (pairs.length > 0) lines.push(pairs.join(' | '));
      }
      const content = lines.join('\n').trim();
      if (content.length > 20) chunks.push({ section: sheetName, content });
    }
  }
  return chunks;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (!options.dir) {
    console.error('用法: node dist/ai/rag/rag.ingest.js --dir <目录> [--clear] [--dry-run]');
    process.exitCode = 1;
    return;
  }
  const root = path.resolve(process.cwd(), options.dir);
  if (!fs.existsSync(root)) {
    console.error(`目录不存在: ${root}`);
    process.exitCode = 1;
    return;
  }

  // 复用服务的 SqliteStore（同一套建表逻辑），用一个最小的 ConfigService 适配器
  const configLike = { get: (key: string) => process.env[key] } as unknown as ConfigService;
  const store = new SqliteStore(configLike);
  const backend = new FtsLexicalBackend(store);

  if (options.clear && !options.dryRun) {
    backend.clear();
    console.log('CLEARED all chunks');
  }

  const files = collectFiles(root);
  let totalChunks = 0;
  let failed = 0;

  for (const file of files) {
    const relative = path.relative(root, file).replace(/\\/g, '/');
    try {
      const ext = path.extname(file).toLowerCase();
      const extracted = SHEET_EXTENSIONS.has(ext)
        ? sheetToChunks(file)
        : splitText(fs.readFileSync(file, 'utf8'));
      if (extracted.length === 0) {
        console.log(`SKIP ${relative} (no content)`);
        continue;
      }
      const items: ChunkInput[] = extracted.map((chunk, index) => ({
        sourcePath: relative,
        title: path.basename(relative),
        section: chunk.section,
        chunkIndex: index,
        content: chunk.content,
        publishedAt: fs.statSync(file).mtime.toISOString().slice(0, 10),
      }));
      if (!options.dryRun) backend.replaceSource(relative, items);
      totalChunks += items.length;
      console.log(`${options.dryRun ? 'DRY' : 'INGESTED'} ${relative} chunks=${items.length}`);
    } catch (error) {
      failed += 1;
      console.error(`FAILED ${relative} message=${error instanceof Error ? error.message : String(error)}`);
    }
  }

  console.log(
    `DONE files=${files.length} chunks=${totalChunks} failed=${failed} total_in_db=${options.dryRun ? 'n/a' : backend.count()}`,
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(`INGEST_FATAL ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exitCode = 1;
});
