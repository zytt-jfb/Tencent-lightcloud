import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import type { EntityManager, ObjectLiteral, Repository } from 'typeorm';
import * as XLSX from 'xlsx';
import { BizPermissionCode } from '@biz-reporting/shared-types';
import { readWorkbookSafe } from '../common/files/workbook-policy';
import { BizOperationLogEntity } from '../operation-logs/biz-operation-log.entity';
import { BizAuthContext, RbacService } from '../rbac/rbac.service';
import { MaintenanceScopeService } from './maintenance-scope.service';

/**
 * 维护数据批量导入（人员 / 车辆 / 油机共用一个引擎）
 *
 * 设计来自业务方的四条硬要求：
 *   1. 不要求用户按模板重排表 —— **按列名匹配**，能对上的列才导入，对不上的列整列忽略；
 *   2. 重复一律覆盖，判重依据是数据库现成的复合唯一键（编号 + 公司 + 区域）；
 *   3. 覆盖是「按出现列做部分更新」，Excel 里没有的列保持原值 —— 否则用户传个三列表
 *      就会把手机号、身份证、证书全部清空；
 *   4. 先预检后提交，预检给出「新增 / 覆盖 / 复活 / 错误」四类计数与逐行原因。
 *
 * 为什么把引擎和三类配置分开：
 *   三种实体的字段不同但流程完全一致，写在三个 service 里就是三份会各自漂移的代码。
 *   这里只放流程，字段清单由各自模块以 BatchImportSpec 声明。
 */

/** 单批行数上限：一次事务里逐行 upsert，2000 行已经能在 2C2G 上控制住耗时 */
export const BATCH_IMPORT_MAX_ROWS = 2000;

export interface ImportColumnSpec {
  /** 实体字段名（camelCase，直接用于 patch） */
  field: string;
  /** 标准中文列名（模板表头、错误提示都用它） */
  label: string;
  /** 其它可识别的写法：中文别名、简称；英文字段名会自动加入 */
  aliases?: readonly string[];
  /** 数据库 NOT NULL 且无默认值：缺列直接整批拒绝，缺值记为该行错误 */
  required?: boolean;
  kind?: 'text' | 'number';
}

export interface BatchImportSpec {
  kind: 'personnel' | 'vehicles' | 'generators';
  label: string;
  /** 判重键，必须与数据库复合唯一索引一致（不含 deleted_at） */
  keyFields: readonly string[];
  keyLabels: readonly string[];
  columns: readonly ImportColumnSpec[];
  /** 用于 assertWritable 的地市字段 */
  orgCityField: string;
}

export interface ImportIssue {
  rowNo: number;
  message: string;
}

export interface MatchedColumn {
  column: string;
  field: string;
  label: string;
}

export interface ImportPreview {
  kind: string;
  label: string;
  totalRows: number;
  createCount: number;
  updateCount: number;
  reviveCount: number;
  errorCount: number;
  /** 表头里没认出来的列（原样回显，让用户知道哪些没进库） */
  ignoredColumns: string[];
  matchedColumns: MatchedColumn[];
  /** 表头层面缺失的必填列 */
  missingRequiredColumns: string[];
  issues: ImportIssue[];
  issuesTruncated: boolean;
  sample: Array<Record<string, unknown>>;
}

export interface ImportCommitResult extends Omit<ImportPreview, 'sample' | 'issuesTruncated'> {
  created: number;
  updated: number;
  revived: number;
  /** 本次导入的批次号，同时写进审计日志；用户报障时提供这个就能定位 */
  batchId: string;
}

interface ParsedRow {
  rowNo: number;
  patch: Record<string, unknown>;
  key: string;
  orgCity: string | null;
  /** 缺失的必填项：只在「新增」时才算错误，覆盖已有记录可以缺（沿用原值） */
  missingRequired: string[];
}

interface ParseOutcome {
  spec: BatchImportSpec;
  rows: ParsedRow[];
  issues: ImportIssue[];
  ignoredColumns: string[];
  matchedColumns: MatchedColumn[];
  missingRequiredColumns: string[];
  headerRowNo: number;
}

const ISSUE_LIMIT = 100;

/**
 * multer 给出的 originalname 是按 latin1 解码的，中文文件名到这里已经变成
 * `Ã¤Â¸Â­` 这类字符。只在疑似乱码时才转，避免把本来正常的文件名转坏。
 * （全仓只有 facts 模块做过这个处理，其它上传路径的中文名一直是花的。）
 */
export function decodeUploadFilename(raw: string | undefined): string {
  const name = String(raw ?? '').trim();
  if (!name) return '未命名文件';
  if (!/[\u0080-\u00ff]/.test(name)) return name;
  try {
    const decoded = Buffer.from(name, 'latin1').toString('utf8');
    return decoded.includes('\ufffd') ? name : decoded;
  } catch {
    return name;
  }
}

/**
 * 表头归一化：去空白、去必填星号、全角括号转半角并去掉括号内容（单位）、去下划线、转小写。
 * 效果：`人员编号*` = `人员编号`；`含税合同额（元）` = `含税合同额`；
 *       `personnelCode` = `personnel_code` = `Personnel Code`。
 */
export function normalizeHeader(raw: unknown): string {
  return String(raw ?? '')
    .replace(/[\s\u3000]/g, '')
    .replace(/[*＊]/g, '')
    .replace(/（/g, '(')
    .replace(/）/g, ')')
    .replace(/\([^)]*\)/g, '')
    .replace(/[_-]/g, '')
    .toLowerCase();
}

function aliasesOf(column: ImportColumnSpec): string[] {
  const out = new Set<string>();
  const push = (value: string | undefined): void => {
    const normalized = normalizeHeader(value);
    if (normalized) out.add(normalized);
  };
  push(column.label);
  push(column.field); // personnelCode / personnel_code 归一化后同形
  for (const alias of column.aliases ?? []) push(alias);
  return [...out];
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === '';
}

function toText(value: unknown): string | null {
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  const text = String(value ?? '').trim();
  return text === '' ? null : text;
}

function toNumber(value: unknown): number | null {
  const text = String(value ?? '').replace(/,/g, '').trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function keyOf(row: Record<string, unknown>, keyFields: readonly string[]): string {
  return keyFields
    .map((field) => String(row[field] ?? '').trim().toLowerCase())
    .join('\u0001');
}

@Injectable()
export class MaintenanceBatchImportService {
  private readonly logger = new Logger(MaintenanceBatchImportService.name);

  constructor(
    private readonly rbac: RbacService,
    private readonly scope: MaintenanceScopeService,
    @InjectRepository(BizOperationLogEntity)
    private readonly opLogRepo: Repository<BizOperationLogEntity>,
  ) {}

  /**
   * 双闸校验：批量导入开关 AND 目标模块写权限。
   * 只查一个都不够 ——
   *   · 只查开关：拿到开关就能绕过合同/维护模块的写权限写数据；
   *   · 只查模块权限：任何能编辑一条记录的人都会在 AI 入口看到批量导入。
   */
  assertCanImport(auth: BizAuthContext, moduleWriteCode: string): void {
    if (auth.isSuperAdmin) return;
    if (!auth.permissionCodes.has(BizPermissionCode.ASSISTANT_IMPORT_EXECUTE)) {
      throw new ForbiddenException('当前账号未开通「批量导入」权限，请联系管理员');
    }
    if (!auth.permissionCodes.has(moduleWriteCode)) {
      throw new ForbiddenException('当前账号没有该模块的写入权限');
    }
  }

  /** 生成模板（表头 + 两行示例；示例行第一列打标记，导入时整行跳过） */
  template(spec: BatchImportSpec): Buffer {
    const header = spec.columns.map((column) => (column.required ? `${column.label}*` : column.label));
    const exampleMarker = '示例（导入时自动忽略本行）';
    const examples = [0, 1].map((index) =>
      spec.columns.map((column, columnIndex) =>
        columnIndex === 0 ? exampleMarker : this.exampleValue(spec, column, index),
      ),
    );
    const sheet = XLSX.utils.aoa_to_sheet([header, ...examples]);
    sheet['!cols'] = header.map((name) => ({ wch: Math.max(12, name.length * 2 + 2) }));
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, spec.label.slice(0, 30));
    return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
  }

  private exampleValue(spec: BatchImportSpec, column: ImportColumnSpec, index: number): string {
    if (column.field === spec.orgCityField) return index === 0 ? '济南市' : '青岛市';
    if (column.required) return index === 0 ? '按实际填写' : '按实际填写';
    return '';
  }

  async preview<T extends ObjectLiteral>(
    repo: Repository<T>,
    spec: BatchImportSpec,
    auth: BizAuthContext,
    buffer: Buffer,
  ): Promise<ImportPreview> {
    const parsed = await this.parse(spec, auth, buffer);
    const plan = await this.planRows(repo, spec, parsed.rows);
    const issues = [...parsed.issues, ...plan.issues];
    return {
      kind: spec.kind,
      label: spec.label,
      totalRows: parsed.rows.length,
      createCount: plan.insert.length,
      updateCount: plan.update.filter((row) => !row.revive).length,
      reviveCount: plan.update.filter((row) => row.revive).length,
      errorCount: issues.length,
      ignoredColumns: parsed.ignoredColumns,
      matchedColumns: parsed.matchedColumns,
      missingRequiredColumns: parsed.missingRequiredColumns,
      issues: issues.slice(0, ISSUE_LIMIT),
      issuesTruncated: issues.length > ISSUE_LIMIT,
      sample: parsed.rows.slice(0, 5).map((row) => ({ rowNo: row.rowNo, ...row.patch })),
    };
  }

  async commit<T extends ObjectLiteral>(
    repo: Repository<T>,
    spec: BatchImportSpec,
    auth: BizAuthContext,
    buffer: Buffer,
    filename?: string,
  ): Promise<ImportCommitResult> {
    const parsed = await this.parse(spec, auth, buffer);
    const plan = await this.planRows(repo, spec, parsed.rows);
    const issues = [...parsed.issues, ...plan.issues];
    const batchId = randomUUID();
    const fileLabel = decodeUploadFilename(filename);

    if (plan.insert.length + plan.update.length === 0) {
      const reason = issues.length ? `没有可导入的数据行：${issues[0].message}` : '没有可导入的数据行';
      await this.writeAudit(auth, spec, batchId, 'failed', { file: fileLabel, totalRows: parsed.rows.length, errors: issues.length }, reason);
      throw new BadRequestException(reason);
    }

    let created = 0;
    let updated = 0;
    let revived = 0;

    try {
      await repo.manager.transaction(async (manager: EntityManager) => {
        for (const row of plan.insert) {
          await manager.insert(repo.target, { ...row.patch, id: randomUUID(), status: 'active' } as never);
          created += 1;
        }
        for (const row of plan.update) {
          // 只更新 Excel 里出现的列；未出现的列保持原值（部分更新）。
          // 不手动写 updatedAt：三个实体都有 @UpdateDateColumn，交给 TypeORM 维护。
          const patch: Record<string, unknown> = { ...row.patch };
          if (row.revive) {
            // 软删除的记录仍占用唯一键，覆盖时必须复活，否则用户会看到「编号已存在」却查不到
            patch.deletedAt = null;
            patch.status = 'active';
            revived += 1;
          } else {
            updated += 1;
          }
          await manager.update(repo.target, row.id, patch as never);
        }
      });
    } catch (error) {
      await this.writeAudit(auth, spec, batchId, 'failed', { file: fileLabel, totalRows: parsed.rows.length, errors: issues.length }, error instanceof Error ? error.message : String(error));
      throw error;
    }

    await this.writeAudit(auth, spec, batchId, 'success', {
      file: fileLabel, totalRows: parsed.rows.length, created, updated, revived, errors: issues.length,
    });

    this.logger.log(
      `BATCH_IMPORT batch=${batchId} kind=${spec.kind} user=${auth.username} rows=${parsed.rows.length} created=${created} updated=${updated} revived=${revived} errors=${issues.length}`,
    );

    return {
      kind: spec.kind,
      label: spec.label,
      totalRows: parsed.rows.length,
      // 以事务内的实际执行结果为准
      createCount: created,
      updateCount: updated,
      reviveCount: revived,
      errorCount: issues.length,
      ignoredColumns: parsed.ignoredColumns,
      matchedColumns: parsed.matchedColumns,
      missingRequiredColumns: parsed.missingRequiredColumns,
      issues: issues.slice(0, ISSUE_LIMIT),
      created,
      updated,
      revived,
      batchId,
    };
  }

  /**
   * 批量导入审计：写 biz_operation_logs（页面「审计日志」可查）。
   * 记录谁、什么时候、导了哪种数据、多少行、覆盖多少、错误多少。
   * 审计本身失败不能让导入失败 —— 只打应用日志，不抛给用户。
   */
  private async writeAudit(
    auth: BizAuthContext,
    spec: BatchImportSpec,
    batchId: string,
    resultStatus: 'success' | 'failed',
    summary: Record<string, unknown>,
    errorMessage?: string,
  ): Promise<void> {
    try {
      await this.opLogRepo.save({
        id: randomUUID(),
        operatorUserId: auth.userId,
        actionType: `maintenance.import.${spec.kind}`,
        targetType: 'maintenance_import',
        targetId: batchId,
        resultStatus,
        summaryBefore: null,
        summaryAfter: JSON.stringify(summary),
        batchId,
        errorMessage: errorMessage ?? null,
      });
    } catch (error) {
      this.logger.error(
        `BATCH_IMPORT_AUDIT_FAILED batch=${batchId} message=${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // ==========================================================================
  // 内部
  // ==========================================================================

  private async parse(
    spec: BatchImportSpec,
    auth: BizAuthContext,
    buffer: Buffer,
  ): Promise<ParseOutcome> {
    if (!buffer?.length) throw new BadRequestException('请选择要导入的 Excel 文件');
    const workbook = readWorkbookSafe(buffer);
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) throw new BadRequestException('文件里没有工作表');
    const matrix = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], { header: 1, defval: '' });
    if (!matrix.length) throw new BadRequestException('工作表是空的');

    const { headerIndex, headerMap, matchedColumns, ignoredColumns } = this.locateHeader(matrix, spec);
    const header = matrix[headerIndex] ?? [];

    // 表头层面：必填列必须存在，缺一个就整批拒绝（不然逐行都会报同样的错，几百条噪音）
    const missingRequiredColumns = spec.columns
      .filter((column) => column.required)
      .filter((column) => !headerMap.some((entry) => entry.column.field === column.field))
      .map((column) => column.label);
    if (missingRequiredColumns.length > 0) {
      throw new BadRequestException(
        `缺少必填列：${missingRequiredColumns.join('、')}。` +
        `如果只想批量修改部分字段，请保留这些列的表头、单元格留空即可（已有记录会沿用原值，新增行会单独报错）。` +
        `当前表头：${header.filter((h) => !isBlank(h)).join('、')}`,
      );
    }

    const rows: ParsedRow[] = [];
    const issues: ImportIssue[] = [];
    const keySpecs = spec.columns.filter((column) => spec.keyFields.includes(column.field));

    for (let i = headerIndex + 1; i < matrix.length; i += 1) {
      const rowNo = i + 1;
      const raw = matrix[i] ?? [];
      if (raw.every((cell) => isBlank(cell))) continue;
      // 模板自带的示例行：第一列固定标记，整行跳过（避免把「示例」当真数据导进去）
      if (String(raw[0] ?? '').includes('示例（导入时')) continue;
      if (rows.length >= BATCH_IMPORT_MAX_ROWS) {
        issues.push({ rowNo, message: `超过单批上限 ${BATCH_IMPORT_MAX_ROWS} 行，请拆分文件` });
        break;
      }

      const patch: Record<string, unknown> = {};
      const rowErrors: string[] = [];
      let orgCity: string | null = null;

      for (const entry of headerMap) {
        const cell = raw[entry.index];
        const column = entry.column;
        if (isBlank(cell)) continue; // 空值 = 不更新该列
        if (column.kind === 'number') {
          const parsed = toNumber(cell);
          if (parsed === null) {
            rowErrors.push(`${column.label}「${String(cell).trim()}」不是有效数字`);
            continue;
          }
          patch[column.field] = parsed;
        } else {
          patch[column.field] = toText(cell);
        }
        if (column.field === spec.orgCityField) orgCity = toText(cell);
      }

      for (const column of keySpecs) {
        if (isBlank(patch[column.field])) rowErrors.push(`${column.label}不能为空`);
      }
      // 数字格式错误、判重键缺失 → 该行无法处理，直接记错误
      if (rowErrors.length > 0) {
        issues.push({ rowNo, message: [...new Set(rowErrors)].join('；') });
        continue;
      }

      /**
       * 其余必填项延后判断：
       *   覆盖已有记录时允许缺（沿用库里原值），只有「新增」才必须填。
       *   否则用户想批量改手机号，就必须把省份/公司/区域全抄一遍才能提交。
       */
      const missingRequired = spec.columns
        .filter((column) => column.required && isBlank(patch[column.field]))
        .map((column) => column.label);

      // 数据范围：能写哪个地市由账号范围决定，范围外的行不静默写入
      try {
        await this.scope.assertWritable(auth, orgCity);
      } catch (error) {
        issues.push({ rowNo, message: error instanceof Error ? error.message : '数据范围校验失败' });
        continue;
      }

      rows.push({ rowNo, patch, key: keyOf(patch, spec.keyFields), orgCity, missingRequired });
    }

    // 文件内部重复：同一条唯一键出现多次，后行覆盖前行，并在预检里提示
    const seen = new Map<string, number>();
    for (const row of rows) {
      const first = seen.get(row.key);
      if (first !== undefined) {
        issues.push({ rowNo: row.rowNo, message: `与第 ${first} 行重复（${spec.keyFields.map((f) => row.patch[f]).join(' / ')}），本行会覆盖前行` });
      } else {
        seen.set(row.key, row.rowNo);
      }
    }

    return { spec, rows, issues, ignoredColumns, matchedColumns, missingRequiredColumns, headerRowNo: headerIndex + 1 };
  }

  /**
   * 定位表头行：默认第一行；若第一行只认得 0~1 列（常见于文件带标题行），
   * 在前 5 行里挑匹配最多的一行。
   */
  private locateHeader(matrix: unknown[][], spec: BatchImportSpec) {
    const build = (rowIndex: number) => {
      const header = matrix[rowIndex] ?? [];
      const headerMap: Array<{ index: number; column: ImportColumnSpec }> = [];
      const matchedColumns: MatchedColumn[] = [];
      const ignoredColumns: string[] = [];
      const used = new Set<string>();
      header.forEach((cell, index) => {
        const normalized = normalizeHeader(cell);
        if (!normalized) return;
        const column = spec.columns.find((candidate) => !used.has(candidate.field) && aliasesOf(candidate).includes(normalized));
        if (!column) {
          ignoredColumns.push(String(cell).trim());
          return;
        }
        used.add(column.field);
        headerMap.push({ index, column });
        matchedColumns.push({ column: String(cell).trim(), field: column.field, label: column.label });
      });
      return { headerIndex: rowIndex, headerMap, matchedColumns, ignoredColumns };
    };

    const first = build(0);
    if (first.headerMap.length > 1) return first;
    let best = first;
    for (let i = 1; i < Math.min(5, matrix.length); i += 1) {
      const candidate = build(i);
      if (candidate.headerMap.length > best.headerMap.length) best = candidate;
    }
    return best;
  }

  /** 判重：一次性把库里（含软删除）的键读进内存，避免每行一次 SELECT */
  private async loadExisting<T extends ObjectLiteral>(
    manager: EntityManager,
    repo: Repository<T>,
    spec: BatchImportSpec,
  ): Promise<Map<string, { id: string; deletedAt: Date | null }>> {
    const select = ['id', ...spec.keyFields, 'deletedAt'];
    const found = await manager.find(repo.target, { select: select as never });
    const map = new Map<string, { id: string; deletedAt: Date | null }>();
    for (const item of found as Array<Record<string, unknown>>) {
      map.set(keyOf(item, spec.keyFields), {
        id: String(item.id),
        deletedAt: (item.deletedAt as Date | null) ?? null,
      });
    }
    return map;
  }

  /**
   * 把解析结果分成「新增 / 覆盖 / 错误」三堆。
   * 必填项缺失只对新增行致命：覆盖已有记录时沿用库里的原值即可。
   */
  private async planRows<T extends ObjectLiteral>(
    repo: Repository<T>,
    spec: BatchImportSpec,
    rows: ParsedRow[],
  ): Promise<{
    insert: ParsedRow[];
    update: Array<ParsedRow & { id: string; revive: boolean }>;
    issues: ImportIssue[];
  }> {
    const existing = await this.loadExisting(repo.manager, repo, spec);
    const insert: ParsedRow[] = [];
    const update: Array<ParsedRow & { id: string; revive: boolean }> = [];
    const issues: ImportIssue[] = [];

    for (const row of rows) {
      const hit = existing.get(row.key);
      if (!hit) {
        if (row.missingRequired.length > 0) {
          issues.push({ rowNo: row.rowNo, message: `新增记录缺少必填项：${row.missingRequired.join('、')}` });
          continue;
        }
        insert.push(row);
        continue;
      }
      update.push({ ...row, id: hit.id, revive: Boolean(hit.deletedAt) });
    }

    return { insert, update, issues };
  }
}
