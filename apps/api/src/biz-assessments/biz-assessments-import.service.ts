import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import { AssessmentBatchEntity } from './assessment-batch.entity';
import { AssessmentRecordEntity } from './assessment-record.entity';
import { CityEntity } from '../main-data/city.entity';
import { CityAliasEntity } from '../main-data/city-alias.entity';
import { ProvinceEntity } from '../main-data/province.entity';
import { BizOperationLogEntity } from '../operation-logs/biz-operation-log.entity';
import { BizAuthContext } from '../rbac/rbac.service';
import {
  buildDedupKey, normalizeCityName, normalizeDisplay, normalizeKey,
  parseEvalMethod, parseEvalMonth, parseScore, round2,
} from './assessment-normalize';

/** 上传文件大小上限：后评价明细单月约 500 行，2MB 足够；超限直接拒绝，避免内存打爆 */
export const ASSESSMENT_FILE_MAX_BYTES = 2 * 1024 * 1024;

type FieldKey = 'seq' | 'projectName' | 'provinceName' | 'cityName' | 'supplierName' | 'score' | 'evalMonth' | 'evalMethod';

/** 表头别名：按表头名匹配（列序可变），命中即用 */
const COLUMN_ALIASES: Record<FieldKey, string[]> = {
  seq: ['序号', '序', '行号'],
  projectName: ['采购项目名称', '项目名称', '采购项目'],
  provinceName: ['省分', '省份', '省公司', '省份名称'],
  cityName: ['地市', '城市', '地市名称', '城市名称'],
  supplierName: ['供应商', '供应商名称', '供应商公司'],
  score: ['分数', '得分', '后评价分数', '后评估分数', '评价分数'],
  evalMonth: ['后评价月份', '后评估月份', '后评价年月', '评价月份', '月份'],
  evalMethod: ['后评价方式', '后评估方式', '评价方式'],
};

const REQUIRED_FIELDS: FieldKey[] = ['projectName', 'supplierName', 'score', 'evalMonth'];

const FIELD_LABEL: Record<FieldKey, string> = {
  seq: '序号', projectName: '采购项目名称', provinceName: '省分', cityName: '地市',
  supplierName: '供应商', score: '分数', evalMonth: '后评价月份', evalMethod: '后评价方式',
};

export interface AssessmentPreviewRow {
  rowNo: number;
  srcSeq: number | null;
  evalMonth: string;
  projectName: string;
  cityName: string;
  cityId: string | null;
  provinceId: string | null;
  supplierName: string;
  score: number;
  evalMethod: 'online' | 'offline';
  dedupKey: string;
  /** 原始整行（表头原文为键），入库写入 raw_json 供回溯 */
  raw: Record<string, unknown>;
}

export interface AssessmentPreviewIssue {
  rowNo: number;
  message: string;
}

export interface AssessmentParseResult {
  sheetName: string;
  /** 实际命中的表头：业务字段 → 原表头文本 */
  headerMap: Partial<Record<FieldKey, string>>;
  totalRows: number;
  rows: AssessmentPreviewRow[];
  duplicateRows: number;
  failedRows: number;
  issues: AssessmentPreviewIssue[];
  unmatchedCities: string[];
  months: string[];
  supplierCount: number;
  methodCount: { online: number; offline: number };
}

export interface AssessmentPreview extends Omit<AssessmentParseResult, 'rows'> {
  filename: string;
  sample: AssessmentPreviewRow[];
}

function normalizeHeader(value: unknown): string {
  return String(value ?? '').replace(/\s/g, '').replace(/（/g, '(').replace(/）/g, ')').toLowerCase();
}

/** 省份名归一化：去掉「省 / 市 / 自治区 / 分公司 / 公司」后缀 */
function normalizeProvinceName(value: string): string {
  return value.trim().replace(/\s/g, '').replace(/(?:分公司|公司)$/, '').replace(/(?:省|市)$/, '').toLowerCase();
}

/**
 * 后评估数据导入（工程管理 / 后评估管理）
 * 口径：
 *  - 粒度 = 采购项目 × 地市 × 供应商 × 后评价月份（Excel 无合同编码，故 contract_id 留空）
 *  - 业务键 dedup_key = import|月份|项目|地市|供应商；同批次内重复只留首条，跨批次按业务键覆盖
 *  - 省分列存在「山东省分公司 / 山东分公司」两种写法，与线上/线下共线，仅用于省份归属，不参与业务键
 */
@Injectable()
export class BizAssessmentsImportService {
  constructor(
    @InjectRepository(AssessmentBatchEntity) private readonly batchRepo: Repository<AssessmentBatchEntity>,
    @InjectRepository(AssessmentRecordEntity) private readonly recordRepo: Repository<AssessmentRecordEntity>,
    @InjectRepository(CityEntity) private readonly cityRepo: Repository<CityEntity>,
    @InjectRepository(CityAliasEntity) private readonly cityAliasRepo: Repository<CityAliasEntity>,
    @InjectRepository(ProvinceEntity) private readonly provinceRepo: Repository<ProvinceEntity>,
    @InjectRepository(BizOperationLogEntity) private readonly opLogRepo: Repository<BizOperationLogEntity>,
  ) {}

  private async recordOp(operatorId: string, actionType: string, targetId: string, resultStatus = 'success'): Promise<void> {
    await this.opLogRepo.save({
      id: randomUUID(), operatorUserId: operatorId, actionType,
      targetType: 'assessment', targetId, resultStatus,
    });
  }

  // ==================== 城市/省份字典 ====================

  /** 地市名称变体：兼容「烟台市分公司 / 烟台市公司 / 烟台市 / 烟台」 */
  private cityVariants(name: string): string[] {
    const variants = new Set<string>();
    const raw = name.trim().replace(/\s/g, '').toLowerCase();
    if (!raw) return [];
    variants.add(raw);
    const base = normalizeCityName(name).toLowerCase();
    variants.add(base);
    const stem = base.replace(/市$/, '');
    variants.add(stem);
    variants.add(`${stem}市`);
    variants.add(`${stem}市分公司`);
    variants.add(`${stem}分公司`);
    variants.add(`${stem}市公司`);
    variants.add(`${stem}公司`);
    return [...variants].filter(Boolean);
  }

  private async buildCityIndex(): Promise<Map<string, CityEntity>> {
    const index = new Map<string, CityEntity>();
    const cities = await this.cityRepo.find();
    const byId = new Map(cities.map((city) => [city.id, city]));
    for (const city of cities) {
      for (const key of this.cityVariants(city.name)) index.set(key, city);
    }
    // 别名表只补充城市名之外的写法（如省本部「省公司 / 省本部」）
    for (const alias of await this.cityAliasRepo.find()) {
      const city = byId.get(alias.cityId);
      if (!city) continue;
      for (const key of this.cityVariants(alias.alias)) index.set(key, city);
    }
    return index;
  }

  private async resolveProvinceId(raw: string): Promise<string | null> {
    const target = normalizeProvinceName(raw);
    if (!target) return null;
    const provinces = await this.provinceRepo.find();
    const hit = provinces.find((province) => normalizeProvinceName(province.name) === target || province.code === raw.trim());
    if (hit) return hit.id;
    return null;
  }

  // ==================== 解析 ====================

  private readSheet(workbook: XLSX.WorkBook): { sheetName: string; header: unknown[]; rows: Array<{ rowNo: number; values: unknown[] }> } {
    const sheetName = workbook.SheetNames[0];
    const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
    if (!sheet || !sheet['!ref']) throw new BadRequestException('文件为空或缺少工作表');
    const range = XLSX.utils.decode_range(sheet['!ref']);
    const cellValue = (row: number, col: number): unknown => {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: col })];
      return cell ? cell.v : '';
    };
    // 表头不一定在第 1 行：在前 10 行里找第一个命中所必需列的作为表头行
    let headerRow = range.s.r;
    for (let row = range.s.r; row <= Math.min(range.s.r + 9, range.e.r); row += 1) {
      const values: unknown[] = [];
      for (let col = range.s.c; col <= range.e.c; col += 1) values.push(cellValue(row, col));
      const normalized = values.map(normalizeHeader);
      const hits = REQUIRED_FIELDS.filter((field) => COLUMN_ALIASES[field].some((alias) => normalized.includes(normalizeHeader(alias)))).length;
      if (hits >= 3) { headerRow = row; break; }
    }
    const header: unknown[] = [];
    for (let col = range.s.c; col <= range.e.c; col += 1) header.push(cellValue(headerRow, col));
    const rows: Array<{ rowNo: number; values: unknown[] }> = [];
    for (let row = headerRow + 1; row <= range.e.r; row += 1) {
      const values: unknown[] = [];
      let hasValue = false;
      for (let col = range.s.c; col <= range.e.c; col += 1) {
        const value = cellValue(row, col);
        if (value !== '' && value !== null && value !== undefined) hasValue = true;
        values.push(value);
      }
      if (hasValue) rows.push({ rowNo: row + 1, values });
    }
    return { sheetName, header, rows };
  }

  /** 解析文件（不落库）：预览与导入共用 */
  async parse(file: { buffer: Buffer; originalname?: string; size?: number }): Promise<AssessmentParseResult> {
    if (!file?.buffer?.length) throw new BadRequestException('未接收到文件内容');
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(file.buffer, { type: 'buffer', cellDates: true });
    } catch {
      throw new BadRequestException('文件无法解析，请确认是 .xlsx / .xls 格式');
    }
    const { sheetName, header, rows } = this.readSheet(workbook);

    // 表头 → 列下标
    const normalizedHeader = header.map(normalizeHeader);
    const columnIndex = new Map<FieldKey, number>();
    const headerMap: Partial<Record<FieldKey, string>> = {};
    for (const field of Object.keys(COLUMN_ALIASES) as FieldKey[]) {
      const aliases = COLUMN_ALIASES[field].map(normalizeHeader);
      const index = normalizedHeader.findIndex((value) => aliases.includes(value));
      if (index >= 0) {
        columnIndex.set(field, index);
        headerMap[field] = String(header[index] ?? '').trim();
      }
    }
    const missing = REQUIRED_FIELDS.filter((field) => !columnIndex.has(field));
    if (missing.length > 0) {
      throw new BadRequestException(`缺少必需列：${missing.map((field) => FIELD_LABEL[field]).join('、')}`);
    }

    const cityIndex = await this.buildCityIndex();
    const provinceCache = new Map<string, string | null>();
    const seenKeys = new Set<string>();
    const parsedRows: AssessmentPreviewRow[] = [];
    const issues: AssessmentPreviewIssue[] = [];
    const unmatchedCitySet = new Set<string>();
    const monthSet = new Set<string>();
    const supplierSet = new Set<string>();
    let duplicateRows = 0;
    let failedRows = 0;

    const pick = (values: unknown[], field: FieldKey): unknown => {
      const index = columnIndex.get(field);
      return index === undefined ? '' : values[index];
    };

    for (const { rowNo, values } of rows) {
      const projectName = normalizeDisplay(pick(values, 'projectName'));
      const supplierName = normalizeDisplay(pick(values, 'supplierName'));
      const rawCityName = normalizeDisplay(pick(values, 'cityName'));
      const evalMonth = parseEvalMonth(pick(values, 'evalMonth'));
      const score = parseScore(pick(values, 'score'));
      const evalMethod = parseEvalMethod(pick(values, 'evalMethod'));
      const rawSeq = pick(values, 'seq');
      const srcSeq = rawSeq === '' || rawSeq === null || rawSeq === undefined ? null : Number(rawSeq);

      if (!projectName) { failedRows += 1; issues.push({ rowNo, message: '采购项目名称为空' }); continue; }
      if (!supplierName) { failedRows += 1; issues.push({ rowNo, message: '供应商为空' }); continue; }
      if (!evalMonth) { failedRows += 1; issues.push({ rowNo, message: `后评价月份无法识别：${String(pick(values, 'evalMonth') ?? '')}` }); continue; }
      if (score === null || score < 0 || score > 100) {
        failedRows += 1;
        issues.push({ rowNo, message: `分数不合法（应为 0-100）：${String(pick(values, 'score') ?? '')}` });
        continue;
      }

      // 地市匹配：先按地市列；匹配不上再试省分列（省本部项目）；都失败则保留原文
      let city = cityIndex.get(normalizeCityName(rawCityName).toLowerCase()) ?? cityIndex.get(rawCityName.toLowerCase());
      if (!city && !rawCityName) city = cityIndex.get(normalizeCityName(normalizeDisplay(pick(values, 'provinceName'))).toLowerCase());
      const cityName = rawCityName || (city ? city.name : '');
      if (!city && cityName) unmatchedCitySet.add(cityName);

      let provinceId = city?.provinceId ?? null;
      if (!provinceId) {
        const provinceRaw = normalizeDisplay(pick(values, 'provinceName'));
        if (provinceRaw) {
          if (!provinceCache.has(provinceRaw)) provinceCache.set(provinceRaw, await this.resolveProvinceId(provinceRaw));
          provinceId = provinceCache.get(provinceRaw) ?? null;
        }
      }

      const dedupKey = buildDedupKey(['import', evalMonth, projectName, city?.id ?? cityName, supplierName]);
      if (seenKeys.has(dedupKey)) { duplicateRows += 1; continue; }
      seenKeys.add(dedupKey);

      monthSet.add(evalMonth);
      supplierSet.add(normalizeKey(supplierName));

      // 原始整行留痕：表头原文为键，Date 转字符串（JSON 列不接受 Date 对象）
      const raw: Record<string, unknown> = {};
      for (let index = 0; index < header.length; index += 1) {
        const key = normalizeDisplay(header[index]);
        if (!key) continue;
        const value = values[index];
        raw[key] = value instanceof Date ? value.toISOString().slice(0, 10) : value;
      }

      parsedRows.push({
        rowNo, srcSeq: Number.isFinite(srcSeq as number) ? srcSeq : null,
        evalMonth, projectName, cityName,
        cityId: city?.id ?? null, provinceId,
        supplierName, score: round2(score), evalMethod, dedupKey, raw,
      });
    }

    return {
      sheetName,
      headerMap,
      totalRows: rows.length,
      rows: parsedRows,
      duplicateRows,
      failedRows,
      issues: issues.slice(0, 200),
      unmatchedCities: [...unmatchedCitySet],
      months: [...monthSet].sort(),
      supplierCount: supplierSet.size,
      methodCount: {
        online: parsedRows.filter((row) => row.evalMethod === 'online').length,
        offline: parsedRows.filter((row) => row.evalMethod === 'offline').length,
      },
    };
  }

  /** 预览：不落库，返回统计 + 前 10 行样例 */
  async preview(file: { buffer: Buffer; originalname?: string; size?: number }): Promise<AssessmentPreview> {
    const parsed = await this.parse(file);
    const { rows, ...rest } = parsed;
    return { ...rest, filename: file.originalname ?? '', sample: rows.slice(0, 10) };
  }

  // ==================== 入库 ====================

  /** 确认导入：同批次内重复已在解析阶段合并，跨批次按业务键覆盖 */
  async commit(auth: BizAuthContext, file: { buffer: Buffer; originalname?: string; size?: number }): Promise<{
    batchId: string; totalRows: number; insertedRows: number; updatedRows: number;
    duplicateRows: number; failedRows: number; months: string[];
  }> {
    const parsed = await this.parse(file);
    if (parsed.rows.length === 0) throw new BadRequestException('文件中没有可导入的有效数据行');

    const batchId = randomUUID();
    const filename = (file.originalname ?? '未命名文件').slice(0, 255);
    await this.batchRepo.save({
      id: batchId,
      filename,
      fileSize: file.buffer.length,
      evalMonth: parsed.months.length === 1 ? parsed.months[0] : null,
      totalRows: parsed.totalRows,
      validRows: parsed.rows.length,
      duplicateRows: parsed.duplicateRows,
      failedRows: parsed.failedRows,
      insertedRows: 0,
      updatedRows: 0,
      status: 'parsed',
      errorJson: parsed.issues.length > 0 ? parsed.issues : null,
      uploadedBy: auth.userId,
      uploadedAt: new Date(),
    });

    // 已存在业务键 → 覆盖；否则新增
    const keys = parsed.rows.map((row) => row.dedupKey);
    const existing = new Map<string, string>();
    for (let index = 0; index < keys.length; index += 200) {
      const chunk = keys.slice(index, index + 200);
      const found = await this.recordRepo.find({ where: { dedupKey: In(chunk) }, select: ['id', 'dedupKey'] });
      for (const item of found) existing.set(item.dedupKey, item.id);
    }

    const toInsert: AssessmentRecordEntity[] = [];
    const toUpdate: Array<{ id: string; row: AssessmentPreviewRow }> = [];
    for (const row of parsed.rows) {
      const id = existing.get(row.dedupKey);
      if (id) {
        toUpdate.push({ id, row });
      } else {
        toInsert.push({
          id: randomUUID(), source: 'import', batchId,
          evalMonth: row.evalMonth, projectName: row.projectName,
          cityId: row.cityId, cityName: row.cityName, provinceId: row.provinceId,
          supplierName: row.supplierName, contractId: null, contractNo: null,
          score: row.score, grade: null, evalMethod: row.evalMethod,
          srcSeq: row.srcSeq, rawJson: row.raw, status: 'active', dedupKey: row.dedupKey,
          submittedBy: null, submittedAt: null, returnedBy: null, returnedAt: null, returnReason: null,
          voidedBy: null, voidedAt: null, voidReason: null,
          createdBy: auth.userId, updatedBy: auth.userId,
        } as AssessmentRecordEntity);
      }
    }

    for (let index = 0; index < toInsert.length; index += 200) {
      await this.recordRepo.insert(toInsert.slice(index, index + 200));
    }
    for (const { id, row } of toUpdate) {
      await this.recordRepo.update({ id }, {
        batchId,
        evalMonth: row.evalMonth,
        projectName: row.projectName,
        cityId: row.cityId,
        cityName: row.cityName,
        provinceId: row.provinceId,
        supplierName: row.supplierName,
        score: row.score,
        evalMethod: row.evalMethod,
        srcSeq: row.srcSeq,
        rawJson: row.raw,
        updatedBy: auth.userId,
      });
    }

    await this.batchRepo.update({ id: batchId }, {
      status: 'imported',
      insertedRows: toInsert.length,
      updatedRows: toUpdate.length,
    });
    await this.recordOp(auth.userId, 'assessment.import.commit', batchId);

    return {
      batchId,
      totalRows: parsed.totalRows,
      insertedRows: toInsert.length,
      updatedRows: toUpdate.length,
      duplicateRows: parsed.duplicateRows,
      failedRows: parsed.failedRows,
      months: parsed.months,
    };
  }

  // ==================== 批次管理 ====================

  async listBatches(): Promise<AssessmentBatchEntity[]> {
    return this.batchRepo.find({ order: { uploadedAt: 'DESC' }, take: 100 });
  }

  /** 删除批次：连带删除该批次导入的明细行（线下填报行不受影响） */
  async deleteBatch(auth: BizAuthContext, id: string): Promise<{ deletedRecords: number }> {
    const batch = await this.batchRepo.findOneBy({ id });
    if (!batch) throw new NotFoundException('导入批次不存在');
    const result = await this.recordRepo.delete({ batchId: id, source: 'import' });
    await this.batchRepo.delete({ id });
    await this.recordOp(auth.userId, 'assessment.import.delete', id);
    return { deletedRecords: result.affected ?? 0 };
  }
}
