import { BadRequestException } from '@nestjs/common';
import * as XLSX from 'xlsx';

/**
 * D-05：集中工作簿策略并限制解析资源（tasks.md D-05 / PG-R10、PG-R11）
 * 所有运行时代码必须经 readWorkbookSafe 解析 Excel，禁止直接 XLSX.read。
 * 限制：sheet ≤ 20、每表行 ≤ 100k、每表列 ≤ 200（按 !ref 解析后立即校验，越限返回稳定 400）。
 * 10MB 文件大小上限由上传侧（D-01 import-upload.config / fact 上传路径）执行。
 */
export const WORKBOOK_LIMITS = {
  maxSheets: 20,
  maxRowsPerSheet: 100_000,
  maxColumnsPerSheet: 200,
} as const;

/** 统一 XLSX.read 封装：解析失败 → 400；解析后立即按 !ref 校验行列/sheet 上限。 */
export function readWorkbookSafe(buffer: Buffer, options?: { maxRowsPerSheet?: number }): XLSX.WorkBook {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer', cellDates: true });
  } catch {
    throw new BadRequestException('Excel 文件无法解析');
  }
  validateWorkbookLimits(workbook, options);
  return workbook;
}

/** 按 !ref 校验：sheet 数、每表行数、每表列数。越限抛稳定 400。 */
export function validateWorkbookLimits(workbook: XLSX.WorkBook, options?: { maxRowsPerSheet?: number }): void {
  const sheetNames = workbook.SheetNames;
  const maxRows = options?.maxRowsPerSheet ?? WORKBOOK_LIMITS.maxRowsPerSheet;
  if (sheetNames.length > WORKBOOK_LIMITS.maxSheets) {
    throw new BadRequestException(`工作簿 sheet 数量（${sheetNames.length}）超过上限 ${WORKBOOK_LIMITS.maxSheets}`);
  }
  for (const name of sheetNames) {
    const sheet = workbook.Sheets[name];
    const ref = sheet?.['!ref'];
    if (!ref) continue;
    let range: XLSX.Range;
    try {
      range = XLSX.utils.decode_range(ref);
    } catch {
      throw new BadRequestException(`工作表「${name}」范围无效`);
    }
    const rows = range.e.r - range.s.r + 1;
    const cols = range.e.c - range.s.c + 1;
    if (rows > maxRows) {
      throw new BadRequestException(`工作表「${name}」行数（${rows}）超过上限 ${maxRows}`);
    }
    if (cols > WORKBOOK_LIMITS.maxColumnsPerSheet) {
      throw new BadRequestException(`工作表「${name}」列数（${cols}）超过上限 ${WORKBOOK_LIMITS.maxColumnsPerSheet}`);
    }
  }
}
