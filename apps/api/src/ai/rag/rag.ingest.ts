import fs from 'node:fs';
import path from 'node:path';
import type { ConfigService } from '@nestjs/config';
import { SqliteStore } from '../sql/sqlite.store';
import { SHEET_EXTENSIONS, TEXT_EXTENSIONS, sheetFileToChunks, splitText } from './chunking';
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
        ? sheetFileToChunks(file)
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

// 只有直接运行（node dist/ai/rag/rag.ingest.js）才执行。
// 被 import 时不能跑 main：否则服务进程一加载这个文件就开始解析命令行参数。
if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(`INGEST_FATAL ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
