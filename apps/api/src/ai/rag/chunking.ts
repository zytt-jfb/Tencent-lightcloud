import * as XLSX from 'xlsx';
import { readWorkbookSafe, validateWorkbookLimits } from '../../common/files/workbook-policy';

/**
 * 文档切块（纯函数，无 IO 依赖）
 *
 * 为什么从 rag.ingest.ts 拆出来：那个文件末尾有 main() 自执行（命令行脚本），
 * 一旦被 Nest 侧 import 就会在服务进程里跑一遍参数解析。切块逻辑要被接口复用，
 * 所以单独放在这里，脚本和接口都从这里引用，保证**只有一份切分规则**。
 */

/** 单段最大字符数：太大检索不精准，太小上下文断裂；800~1200 是经验区间 */
const MAX_CHUNK_CHARS = 1000;

/** 文本类扩展名 */
export const TEXT_EXTENSIONS = new Set(['.md', '.markdown', '.txt']);

/** 表格类扩展名 */
export const SHEET_EXTENSIONS = new Set(['.xlsx', '.xls']);

export interface RawChunk {
  section: string | null;
  content: string;
}

/**
 * 文本切分：优先按标题（# / ## / ###），没有标题时按空行分段，再按长度合并/拆分。
 * 每个片段保留 section，回答时可以标注「出自《XX》第几节」。
 */
export function splitText(text: string): RawChunk[] {
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

  const chunks: RawChunk[] = [];
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

/** 知识库文件的单表行数上限：这是"制度/口径"文档，20 万行已经超出知识库的用途 */
const MAX_KNOWLEDGE_ROWS = 20_000;

/**
 * Excel → 文本：每个 sheet 一段（首行为表头，每 40 行一组，避免一个 sheet 变成巨型片段）
 *
 * 只接受已解析好的 workbook：解析必须由调用方经 readWorkbookSafe 完成，
 * 否则 10MB 的压缩 xlsx 解出千万行会直接打爆 2G 内存（仓库约定见 workbook-policy.ts）。
 */
export function sheetToChunks(workbook: XLSX.WorkBook): RawChunk[] {
  const chunks: RawChunk[] = [];
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

/** 命令行脚本入口：读路径 + 校验上限 */
export function sheetFileToChunks(filePath: string): RawChunk[] {
  const workbook = XLSX.readFile(filePath);
  validateWorkbookLimits(workbook, { maxRowsPerSheet: MAX_KNOWLEDGE_ROWS });
  return sheetToChunks(workbook);
}

/**
 * 按文件名后缀选择切分方式。未知后缀返回空数组 —— 由调用方决定是否报错，
 * 这里不抛异常（切块是纯函数，策略判断留给接口层）。
 */
export function chunkFile(fileName: string, buffer: Buffer): RawChunk[] {
  const dot = fileName.lastIndexOf('.');
  const ext = dot >= 0 ? fileName.slice(dot).toLowerCase() : '';
  if (TEXT_EXTENSIONS.has(ext)) return splitText(buffer.toString('utf8'));
  // Excel 一律经 readWorkbookSafe：它做的是"先设上限再解析"，而不是解析完才校验
  if (SHEET_EXTENSIONS.has(ext)) return sheetToChunks(readWorkbookSafe(buffer, { maxRowsPerSheet: MAX_KNOWLEDGE_ROWS }));
  return [];
}
