import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { DataSource, In, Repository } from 'typeorm';
import * as XLSX from 'xlsx';
import { readWorkbookSafe } from '../common/files/workbook-policy';
import type { FactImportResult, FactValidationIssue } from '@biz-reporting/shared-types';
import { SoftDeleteFlag } from '@biz-reporting/shared-types';
import { CityEntity } from '../cities/city.entity';
import { AllocationEntity } from '../contracts/allocation.entity';
import { ContractEntity } from '../contracts/contract.entity';
import { OperationLogEntity } from '../common/entities/operation-log.entity';
import { CostFactEntity } from './cost-fact.entity';
import { FactImportBatchEntity } from './fact-import-batch.entity';
import { FactSourceRowEntity } from './fact-source-row.entity';
import { FactVersionEntity } from './fact-version.entity';
import { OrderFactEntity } from './order-fact.entity';
import { FactSourceFileStorageService, StoredFactSourceFile } from './fact-source-file-storage.service';

interface Actor {
  userId: number;
  cityId: number | null;
}

interface ParsedRow<T> {
  sheetName: string;
  rowNumber: number;
  raw: Record<string, unknown>;
  normalized: T;
  businessKey?: string;
}

interface ParsedCost {
  contractCode: string;
  occurredOn: string;
  categoryCode: string;
  subtype: string;
  description: string;
  amount: number;
  actualSpender: string | null;
  advancePayer: string | null;
  receiptType: string | null;
  approvalNumber: string | null;
  approvalStatus: string | null;
  dingTalkDataId: string | null;
  mileage: number | null;
  locations: string[];
  attachments: string[];
  sourceCityName: string | null;
  sourceType: string;
}

interface ParsedOrder {
  contractCode: string;
  sourceCityName: string;
  purchaseOrderNo: string;
  orderStatus: string;
  taxInclusiveAmount: number;
  materialName: string;
  materialCode: string;
  projectCode: string | null;
  projectName: string | null;
  siteCode: string | null;
  siteName: string | null;
  orderedAt: Date;
  receiptStatus: string | null;
  quantity: number | null;
  sourceType: string;
}

@Injectable()
export class FactImportService {
  constructor(
    @InjectRepository(FactImportBatchEntity) private readonly batchRepo: Repository<FactImportBatchEntity>,
    @InjectRepository(CityEntity) private readonly cityRepo: Repository<CityEntity>,
    @InjectRepository(ContractEntity) private readonly contractRepo: Repository<ContractEntity>,
    @InjectRepository(AllocationEntity) private readonly allocationRepo: Repository<AllocationEntity>,
    @InjectRepository(FactSourceRowEntity) private readonly sourceRowRepo: Repository<FactSourceRowEntity>,
    @InjectRepository(CostFactEntity) private readonly costFactRepo: Repository<CostFactEntity>,
    @InjectRepository(OrderFactEntity) private readonly orderFactRepo: Repository<OrderFactEntity>,
    @InjectRepository(FactVersionEntity) private readonly versionRepo: Repository<FactVersionEntity>,
    @InjectRepository(OperationLogEntity) private readonly operationLogRepo: Repository<OperationLogEntity>,
    private readonly sourceFiles: FactSourceFileStorageService,
    private readonly dataSource: DataSource,
  ) {}

  async importCost(
    file: Express.Multer.File,
    actor: Actor,
    templateType: string,
    contractCode?: string,
  ): Promise<FactImportResult> {
    const cityId = this.requireCity(actor);
    const hash = this.hash(file.buffer);
    const evidence = await this.sourceFiles.store(file.buffer, file.originalname, hash);
    const existing = await this.completedBatch(cityId, 'cost', hash);
    if (existing) {
      await this.ensureEvidence(existing, file, evidence);
      return this.toResult(existing, true);
    }

    let detected = templateType;
    try {
      const workbook = this.readWorkbook(file.buffer);
      detected = templateType === 'auto' ? this.detectCostTemplate(workbook) : templateType;
      let parsed: ParsedRow<ParsedCost>[] = [];
      const issues: FactValidationIssue[] = [];
      if (detected === 'daily_reimbursement') {
        if (!contractCode?.trim()) throw new BadRequestException('日常报销文件没有合同列，上传时必须选择已分配合同');
        parsed = this.parseDailyCosts(workbook, contractCode.trim(), issues);
      } else if (detected === 'mileage_subsidy') {
        if (!contractCode?.trim()) throw new BadRequestException('里程油补文件没有合同列，上传时必须选择已分配合同');
        parsed = this.parseMileageCosts(workbook, contractCode.trim(), issues);
      } else if (detected === 'standard_cost') {
        parsed = this.parseStandardCosts(workbook, issues);
      } else {
        throw new BadRequestException('无法识别成本模板；业务招待费旧文件须先转换为标准成本模板');
      }
      return await this.persistCostBatch(file, actor, detected, hash, parsed, issues, evidence);
    } catch (error) {
      return this.recordUnparsedFailure(file, actor, 'cost', detected || 'unknown', hash, evidence, error);
    }
  }

  async importOrders(file: Express.Multer.File, actor: Actor): Promise<FactImportResult> {
    const cityId = this.requireCity(actor);
    const hash = this.hash(file.buffer);
    const evidence = await this.sourceFiles.store(file.buffer, file.originalname, hash);
    const existing = await this.completedBatch(cityId, 'order', hash);
    if (existing) {
      await this.ensureEvidence(existing, file, evidence);
      return this.toResult(existing, true);
    }
    try {
      const issues: FactValidationIssue[] = [];
      const parsed = this.parseOrders(this.readWorkbook(file.buffer), issues);
      return await this.persistOrderBatch(file, actor, hash, parsed, issues, evidence);
    } catch (error) {
      return this.recordUnparsedFailure(file, actor, 'order', 'ecommerce_order_34', hash, evidence, error);
    }
  }

  private async persistCostBatch(
    file: Express.Multer.File,
    actor: Actor,
    templateType: string,
    hash: string,
    rows: ParsedRow<ParsedCost>[],
    parseIssues: FactValidationIssue[],
    evidence: StoredFactSourceFile,
  ): Promise<FactImportResult> {
    const cityId = this.requireCity(actor);
    const city = await this.cityRepo.findOne({ where: { id: cityId } });
    if (!city) throw new BadRequestException('登录账号绑定地市不存在');
    const issues = [...parseIssues];
    this.validateSourceCities(rows, city.name, issues);
    const contracts = await this.resolveAllocatedContracts(cityId, rows.map((row) => row.normalized.contractCode), issues, rows);
    const blockingIssues = issues.filter((issue) => issue.severity !== 'warning');
    const warnings = issues.filter((issue) => issue.severity === 'warning');

    return this.dataSource.transaction(async (manager) => {
      const batchRepo = manager.getRepository(FactImportBatchEntity);
      const sourceRepo = manager.getRepository(FactSourceRowEntity);
      const factRepo = manager.getRepository(CostFactEntity);
      const versionRepo = manager.getRepository(FactVersionEntity);
      const logRepo = manager.getRepository(OperationLogEntity);
      let batch = await batchRepo.findOne({ where: { cityId, factKind: 'cost', fileSha256: hash } });
      if (batch) await sourceRepo.delete({ importBatchId: batch.id });
      batch = batch ?? batchRepo.create({ factKind: 'cost', cityId, operatorUserId: actor.userId, fileSha256: hash } as FactImportBatchEntity);
      Object.assign(batch, {
        templateType,
        sourceFileName: this.decodeFileName(file.originalname),
        sourceFileStorageKey: evidence.storageKey,
        sourceFileSize: evidence.size,
        sourceFileStoredAt: evidence.storedAt,
        status: blockingIssues.length ? 'failed' : 'processing',
        lifecycleStatus: blockingIssues.length ? 'validation_failed' : 'processing',
        totalRows: rows.length, successRows: 0,
        errorRows: blockingIssues.length ? new Set(blockingIssues.map((issue) => issue.rowNumber)).size : 0,
        warningCount: warnings.length, blockingErrorCount: blockingIssues.length,
        errorSummaryJson: issues.length ? issues : null, completedAt: blockingIssues.length ? new Date() : null, effectiveAt: null,
      });
      batch = await batchRepo.save(batch);
      const sourceRows = await sourceRepo.save(rows.map((row) => sourceRepo.create({
        importBatchId: batch.id,
        sheetName: row.sheetName,
        rowNumber: row.rowNumber,
        rowHash: this.hashJson(row.raw),
        businessKey: null,
        rawJson: row.raw,
        normalizedJson: row.normalized as unknown as Record<string, unknown>,
        status: blockingIssues.some((issue) => issue.rowNumber === row.rowNumber) ? 'invalid'
          : warnings.some((issue) => issue.rowNumber === row.rowNumber) ? 'warning' : 'valid',
        errorsJson: issues.filter((issue) => issue.rowNumber === row.rowNumber),
      })));
      if (blockingIssues.length) {
        await logRepo.save(logRepo.create({
          operatorUserId: actor.userId, operatorCityId: cityId, actionType: 'cost_import', targetType: 'fact_import_batch',
          targetId: String(batch.id), summaryText: `成本导入校验失败，共 ${blockingIssues.length} 个阻塞问题`, beforeDataJson: null,
          afterDataJson: { batchId: batch.id, fileSha256: hash, storageKey: evidence.storageKey }, resultStatus: 'failed',
        }));
        return this.toResult(batch, false);
      }

      const facts = await factRepo.save(rows.map((row, index) => {
        const value = row.normalized;
        const contract = contracts.get(value.contractCode)!;
        const date = new Date(`${value.occurredOn}T00:00:00`);
        return factRepo.create({
          cityId,
          contractId: contract.id,
          occurredOn: value.occurredOn,
          periodYear: date.getFullYear(),
          periodMonth: date.getMonth() + 1,
          costCategoryCode: value.categoryCode,
          costSubtype: value.subtype,
          description: value.description,
          amount: value.amount,
          actualSpender: value.actualSpender,
          advancePayer: value.advancePayer,
          receiptType: value.receiptType,
          approvalNumber: value.approvalNumber,
          approvalStatus: value.approvalStatus,
          dingTalkDataId: value.dingTalkDataId,
          mileage: value.mileage,
          locationsJson: value.locations,
          attachmentsJson: value.attachments,
          rawPayloadJson: row.raw,
          sourceType: value.sourceType,
          importBatchId: batch.id,
          sourceRowId: sourceRows[index].id,
          reversedFactId: null,
          isReversed: 0,
          versionNo: 1,
          createdBy: actor.userId,
          updatedBy: actor.userId,
        });
      }));
      await sourceRepo.update({ importBatchId: batch.id }, { status: 'written' });
      await versionRepo.save(facts.map((fact, index) => {
        const rowWarnings = warnings.filter((issue) => issue.rowNumber === rows[index].rowNumber);
        return versionRepo.create({
          factType: 'cost', factId: fact.id, cityId: fact.cityId, contractId: fact.contractId,
          periodYear: fact.periodYear, periodMonth: fact.periodMonth, versionNo: 1, changeType: 'create',
          lifecycleStatus: rowWarnings.length ? 'effective_with_warning' : 'current_effective',
          supersedesVersionId: null, supersededByVersionId: null, beforeDataJson: null, afterDataJson: fact,
          changedFieldsJson: Object.keys(fact), warningSummaryJson: rowWarnings, reason: 'Excel 导入',
          operatorUserId: actor.userId, sourceType: fact.sourceType, importBatchId: batch.id,
        });
      }));
      await logRepo.save(logRepo.create({
        operatorUserId: actor.userId, operatorCityId: cityId, actionType: 'cost_import', targetType: 'fact_import_batch',
        targetId: String(batch.id), summaryText: `导入成本事实 ${facts.length} 行`, beforeDataJson: null,
        afterDataJson: { batchId: batch.id, rows: facts.length, fileSha256: hash }, resultStatus: 'success',
      }));
      const effectiveAt = new Date();
      Object.assign(batch, { status: 'completed', lifecycleStatus: warnings.length ? 'effective_with_warning' : 'current_effective',
        successRows: facts.length, errorRows: 0, warningCount: warnings.length, blockingErrorCount: 0,
        resultSummaryJson: { rows: facts.length, warnings: warnings.length }, completedAt: effectiveAt, effectiveAt });
      await batchRepo.save(batch);
      return this.toResult(batch, false);
    });
  }

  private async persistOrderBatch(
    file: Express.Multer.File,
    actor: Actor,
    hash: string,
    rows: ParsedRow<ParsedOrder>[],
    parseIssues: FactValidationIssue[],
    evidence: StoredFactSourceFile,
  ): Promise<FactImportResult> {
    const cityId = this.requireCity(actor);
    const city = await this.cityRepo.findOne({ where: { id: cityId } });
    if (!city) throw new BadRequestException('登录账号绑定地市不存在');
    const issues = [...parseIssues];
    this.validateSourceCities(rows, city.name, issues);
    this.validateBusinessKeyConflicts(rows, issues);
    const existingKeys = rows.length
      ? await this.dataSource.getRepository(OrderFactEntity).find({
        where: { cityId, businessKey: In(rows.map((row) => row.businessKey!)) },
        select: { businessKey: true, id: true },
      })
      : [];
    const persistedKeys = new Set(existingKeys.map((item) => item.businessKey));
    rows.forEach((row) => {
      if (persistedKeys.has(row.businessKey!)) {
        issues.push(this.issue(row.rowNumber, '行级业务键', '该订单行已由其他文件导入', '检查历史批次，不要重复累计同一业务行'));
      }
    });
    const contracts = await this.resolveAllocatedContracts(cityId, rows.map((row) => row.normalized.contractCode), issues, rows);
    const blockingIssues = issues.filter((issue) => issue.severity !== 'warning');
    const warnings = issues.filter((issue) => issue.severity === 'warning');

    return this.dataSource.transaction(async (manager) => {
      const batchRepo = manager.getRepository(FactImportBatchEntity);
      const sourceRepo = manager.getRepository(FactSourceRowEntity);
      const factRepo = manager.getRepository(OrderFactEntity);
      const versionRepo = manager.getRepository(FactVersionEntity);
      const logRepo = manager.getRepository(OperationLogEntity);
      let batch = await batchRepo.findOne({ where: { cityId, factKind: 'order', fileSha256: hash } });
      if (batch) await sourceRepo.delete({ importBatchId: batch.id });
      batch = batch ?? batchRepo.create({ factKind: 'order', cityId, operatorUserId: actor.userId, fileSha256: hash } as FactImportBatchEntity);
      Object.assign(batch, {
        templateType: 'ecommerce_order_34', sourceFileName: this.decodeFileName(file.originalname),
        sourceFileStorageKey: evidence.storageKey, sourceFileSize: evidence.size, sourceFileStoredAt: evidence.storedAt,
        status: blockingIssues.length ? 'failed' : 'processing', lifecycleStatus: blockingIssues.length ? 'validation_failed' : 'processing',
        totalRows: rows.length, successRows: 0, errorRows: blockingIssues.length ? new Set(blockingIssues.map((issue) => issue.rowNumber)).size : 0,
        warningCount: warnings.length, blockingErrorCount: blockingIssues.length,
        errorSummaryJson: issues.length ? issues : null, completedAt: blockingIssues.length ? new Date() : null, effectiveAt: null,
      });
      batch = await batchRepo.save(batch);
      const sourceRows = await sourceRepo.save(rows.map((row) => sourceRepo.create({
        importBatchId: batch.id, sheetName: row.sheetName, rowNumber: row.rowNumber,
        rowHash: this.hashJson(row.raw), businessKey: row.businessKey ?? null, rawJson: row.raw,
        normalizedJson: row.normalized as unknown as Record<string, unknown>,
        status: blockingIssues.some((issue) => issue.rowNumber === row.rowNumber) ? 'invalid'
          : warnings.some((issue) => issue.rowNumber === row.rowNumber) ? 'warning' : 'valid',
        errorsJson: issues.filter((issue) => issue.rowNumber === row.rowNumber),
      })));
      if (blockingIssues.length) {
        await logRepo.save(logRepo.create({
          operatorUserId: actor.userId, operatorCityId: cityId, actionType: 'order_import', targetType: 'fact_import_batch',
          targetId: String(batch.id), summaryText: `订单导入校验失败，共 ${blockingIssues.length} 个阻塞问题`, beforeDataJson: null,
          afterDataJson: { batchId: batch.id, fileSha256: hash, storageKey: evidence.storageKey }, resultStatus: 'failed',
        }));
        return this.toResult(batch, false);
      }

      const facts = await factRepo.save(rows.map((row, index) => {
        const value = row.normalized;
        const contract = contracts.get(value.contractCode)!;
        return factRepo.create({
          cityId, contractId: contract.id, purchaseOrderNo: value.purchaseOrderNo, orderStatus: value.orderStatus,
          taxInclusiveAmount: value.taxInclusiveAmount, materialName: value.materialName, materialCode: value.materialCode,
          projectCode: value.projectCode, projectName: value.projectName, siteCode: value.siteCode, siteName: value.siteName,
          orderedAt: value.orderedAt, periodYear: value.orderedAt.getFullYear(), periodMonth: value.orderedAt.getMonth() + 1,
          receiptStatus: value.receiptStatus, sourceType: value.sourceType, importBatchId: batch.id,
          sourceRowId: sourceRows[index].id, businessKey: row.businessKey!, isReversal: value.taxInclusiveAmount < 0 ? 1 : 0,
          isReversed: 0, reversedFactId: null, rawPayloadJson: row.raw, versionNo: 1,
          createdBy: actor.userId, updatedBy: actor.userId,
        });
      }));
      await sourceRepo.update({ importBatchId: batch.id }, { status: 'written' });
      await versionRepo.save(facts.map((fact, index) => {
        const rowWarnings = warnings.filter((issue) => issue.rowNumber === rows[index].rowNumber);
        return versionRepo.create({
          factType: 'order', factId: fact.id, cityId: fact.cityId, contractId: fact.contractId,
          periodYear: fact.periodYear, periodMonth: fact.periodMonth, versionNo: 1, changeType: 'create',
          lifecycleStatus: rowWarnings.length ? 'effective_with_warning' : 'current_effective',
          supersedesVersionId: null, supersededByVersionId: null, beforeDataJson: null, afterDataJson: fact,
          changedFieldsJson: Object.keys(fact), warningSummaryJson: rowWarnings, reason: 'Excel 导入',
          operatorUserId: actor.userId, sourceType: fact.sourceType, importBatchId: batch.id,
        });
      }));
      await logRepo.save(logRepo.create({
        operatorUserId: actor.userId, operatorCityId: cityId, actionType: 'order_import', targetType: 'fact_import_batch',
        targetId: String(batch.id), summaryText: `导入订单事实 ${facts.length} 行`, beforeDataJson: null,
        afterDataJson: { batchId: batch.id, rows: facts.length, fileSha256: hash }, resultStatus: 'success',
      }));
      const effectiveAt = new Date();
      Object.assign(batch, { status: 'completed', lifecycleStatus: warnings.length ? 'effective_with_warning' : 'current_effective',
        successRows: facts.length, errorRows: 0, warningCount: warnings.length, blockingErrorCount: 0,
        resultSummaryJson: { rows: facts.length, warnings: warnings.length }, completedAt: effectiveAt, effectiveAt });
      await batchRepo.save(batch);
      return this.toResult(batch, false);
    });
  }

  private parseDailyCosts(workbook: XLSX.WorkBook, contractCode: string, issues: FactValidationIssue[]): ParsedRow<ParsedCost>[] {
    const selected = this.findSheet(workbook, ['报销项目', '日期', '事由', '金额']);
    if (!selected) throw new BadRequestException('日常报销模板缺少必需表头');
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(selected.sheet, { defval: null, raw: false });
    let category = '';
    const result: ParsedRow<ParsedCost>[] = [];
    rows.forEach((raw, index) => {
      const rowNumber = index + 2;
      const label = this.text(raw['报销项目']);
      const isSummary = /合计|总金额/.test(label);
      if (label && !isSummary) category = label;
      if (isSummary || !this.text(raw['日期']) && !this.text(raw['事由']) && !this.text(raw['金额'])) return;
      const date = this.dateString(raw['日期']);
      const amount = this.number(raw['金额']);
      if (!this.text(raw['事由'])) issues.push(this.issue(rowNumber, '事由', '事由为空，已使用占位文本', '补充真实事由以提高数据质量', 'warning'));
      if (!date) issues.push(this.issue(rowNumber, '日期', '日期为空或格式无法识别', '填写有效发生日期'));
      if (amount === null || amount === 0) issues.push(this.issue(rowNumber, '金额', '金额为空、非数字或为 0', '填写有效金额'));
      result.push({ sheetName: selected.name, rowNumber, raw, normalized: {
        contractCode, occurredOn: date ?? '1970-01-01', categoryCode: this.costCategory(category), subtype: category || '日常报销',
        description: this.text(raw['事由']) || '未填写事由', amount: amount ?? 0,
        actualSpender: this.nullText(raw['实际花费人']), advancePayer: this.nullText(raw['垫付人员']),
        receiptType: this.nullText(raw['发票']), approvalNumber: this.nullText(raw['钉钉流程号']),
        approvalStatus: null, dingTalkDataId: null, mileage: null, locations: [],
        attachments: ['支付截图（收据）', '领导审批凭证'].map((key) => this.text(raw[key])).filter(Boolean),
        sourceCityName: null, sourceType: 'excel_daily_reimbursement',
      }});
    });
    return result;
  }

  private parseMileageCosts(workbook: XLSX.WorkBook, contractCode: string, issues: FactValidationIssue[]): ParsedRow<ParsedCost>[] {
    const selected = this.findSheet(workbook, ['数据id', '所属地市', '审批编号', '本流程内用车里程数']);
    if (!selected) throw new BadRequestException('里程油补模板缺少必需表头');
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(selected.sheet, { defval: null, raw: false });
    return rows.flatMap((raw, index) => {
      const rowNumber = index + 2;
      if (!this.text(raw['数据id'])) return [];
      const mileage = this.number(raw['本流程内用车里程数']);
      const date = this.dateString(raw['完成时间'] ?? raw['更新时间'] ?? raw['创建时间']);
      if (!date) issues.push(this.issue(rowNumber, '完成时间', '无法识别发生日期', '补充有效完成时间'));
      if (mileage === null || mileage === 0) issues.push(this.issue(rowNumber, '本流程内用车里程数', '里程/补贴金额为空或无效', '填写有效数值'));
      const entries = Object.entries(raw);
      return [{ sheetName: selected.name, rowNumber, raw, normalized: {
        contractCode, occurredOn: date ?? '1970-01-01', categoryCode: 'fuel', subtype: '里程油补',
        description: this.text(raw['用车事由']) || '里程油补', amount: mileage ?? 0,
        actualSpender: this.nullText(raw['创建人']), advancePayer: null, receiptType: null,
        approvalNumber: this.nullText(raw['审批编号']), approvalStatus: this.nullText(raw['审批结果'] ?? raw['审批状态']),
        dingTalkDataId: this.nullText(raw['数据id']), mileage, sourceCityName: this.nullText(raw['所属地市']),
        locations: entries.filter(([key]) => key.includes('地点')).map(([, value]) => this.text(value)).filter(Boolean),
        attachments: entries.filter(([, value]) => /^https?:\/\//.test(this.text(value))).map(([, value]) => this.text(value)),
        sourceType: 'excel_mileage_subsidy',
      }}];
    });
  }

  private parseStandardCosts(workbook: XLSX.WorkBook, issues: FactValidationIssue[]): ParsedRow<ParsedCost>[] {
    const selected = this.findSheet(workbook, ['成本类别', '日期', '事由', '金额', '合同编号']);
    if (!selected) throw new BadRequestException('标准成本模板缺少成本类别、日期、事由、金额或合同编号');
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(selected.sheet, { defval: null, raw: false });
    return rows.flatMap((raw, index) => {
      const rowNumber = index + 2;
      if (!Object.values(raw).some((value) => this.text(value))) return [];
      const date = this.dateString(raw['日期']);
      const amount = this.number(raw['金额']);
      const code = this.text(raw['合同编号']);
      if (!code) issues.push(this.issue(rowNumber, '合同编号', '合同编号为空', '填写本地市已分配合同编号'));
      if (!date) issues.push(this.issue(rowNumber, '日期', '日期无效', '填写有效发生日期'));
      if (amount === null || amount === 0) issues.push(this.issue(rowNumber, '金额', '金额为空、非数字或为 0', '填写有效金额'));
      return [{ sheetName: selected.name, rowNumber, raw, normalized: {
        contractCode: code, occurredOn: date ?? '1970-01-01', categoryCode: this.costCategory(this.text(raw['成本类别'])),
        subtype: this.text(raw['成本子类型']) || this.text(raw['成本类别']), description: this.text(raw['事由']) || '未填写事由', amount: amount ?? 0,
        actualSpender: this.nullText(raw['实际花费人']), advancePayer: this.nullText(raw['垫付人员']), receiptType: this.nullText(raw['票据类型']),
        approvalNumber: this.nullText(raw['审批编号']), approvalStatus: this.nullText(raw['审批状态']), dingTalkDataId: this.nullText(raw['钉钉数据ID']),
        mileage: this.number(raw['里程']), locations: [], attachments: [], sourceCityName: this.nullText(raw['所属地市']), sourceType: 'excel_standard_cost',
      }}];
    });
  }

  private parseOrders(workbook: XLSX.WorkBook, issues: FactValidationIssue[]): ParsedRow<ParsedOrder>[] {
    const selected = this.findSheet(workbook, ['采购订单编号', '合同编号', '地市名称', '含税总金额', '物料编码', '下单时间']);
    if (!selected) throw new BadRequestException('订单文件缺少 34 列模板的关键表头');
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(selected.sheet, { defval: null, raw: false });
    return rows.flatMap((raw, index) => {
      const rowNumber = index + 2;
      if (!this.text(raw['采购订单编号']) && !this.text(raw['合同编号'])) return [];
      const amount = this.number(raw['含税总金额']);
      const orderedAt = this.date(raw['下单时间']);
      const contractCode = this.text(raw['合同编号']);
      const po = this.text(raw['采购订单编号']);
      const materialCode = this.text(raw['物料编码']);
      if (!contractCode) issues.push(this.issue(rowNumber, '合同编号', '合同编号为空', '填写本地市已分配合同编号'));
      if (!po) issues.push(this.issue(rowNumber, '采购订单编号', '采购订单编号为空', '补充采购订单编号'));
      if (!materialCode) issues.push(this.issue(rowNumber, '物料编码', '物料编码为空', '补充物料编码'));
      if (amount === null) issues.push(this.issue(rowNumber, '含税总金额', '含税总金额不是有效数字', '填写行级含税金额；负数冲销允许'));
      if (!orderedAt) issues.push(this.issue(rowNumber, '下单时间', '下单时间无效', '填写有效下单时间'));
      const normalized: ParsedOrder = {
        contractCode, sourceCityName: this.text(raw['地市名称']), purchaseOrderNo: po,
        orderStatus: this.text(raw['订单主状态']) || '未标记', taxInclusiveAmount: amount ?? 0,
        materialName: this.text(raw['物料名称']) || this.text(raw['商品名称']), materialCode,
        projectCode: this.nullText(raw['项目编号']), projectName: this.nullText(raw['项目名称']),
        siteCode: this.nullText(raw['站址编号']), siteName: this.nullText(raw['站址信息']),
        orderedAt: orderedAt ?? new Date(0), receiptStatus: this.nullText(raw['收货状态']), quantity: this.number(raw['采购数量']),
        sourceType: 'excel_ecommerce_order',
      };
      const businessKey = this.orderBusinessKey(normalized);
      return [{ sheetName: selected.name, rowNumber, raw, normalized, businessKey }];
    });
  }

  private async resolveAllocatedContracts<T extends { contractCode: string }>(
    cityId: number,
    codes: string[],
    issues: FactValidationIssue[],
    rows: ParsedRow<T>[],
  ): Promise<Map<string, ContractEntity>> {
    const unique = [...new Set(codes.filter(Boolean))];
    const contracts = unique.length ? await this.contractRepo.find({ where: { contractCode: In(unique), isDeleted: SoftDeleteFlag.NOT_DELETED } }) : [];
    const byCode = new Map(contracts.map((item) => [item.contractCode, item]));
    const ids = contracts.map((item) => item.id);
    const allocations = ids.length ? await this.allocationRepo.find({ where: { cityId, contractId: In(ids) } }) : [];
    const allocated = new Set(allocations.map((item) => item.contractId));
    rows.forEach((row) => {
      const code = row.normalized.contractCode;
      const contract = byCode.get(code);
      if (!contract || !allocated.has(contract.id)) {
        issues.push(this.issue(row.rowNumber, '合同编号', `合同 ${code || '(空)'} 未分配给当前地市`, '先由管理员完成合同地市分配，再重新导入'));
      }
    });
    return byCode;
  }

  private validateSourceCities<T extends { sourceCityName: string | null }>(rows: ParsedRow<T>[], cityName: string, issues: FactValidationIssue[]) {
    const expected = this.normalizeCityName(cityName);
    rows.forEach((row) => {
      const source = row.normalized.sourceCityName;
      if (source && this.normalizeCityName(source) !== expected) {
        issues.push(this.issue(row.rowNumber, '所属地市', `文件地市“${source}”与登录地市“${cityName}”不一致`, '按登录地市拆分文件后重新导入'));
      }
    });
  }

  private validateBusinessKeyConflicts(rows: ParsedRow<ParsedOrder>[], issues: FactValidationIssue[]) {
    const map = new Map<string, number[]>();
    rows.forEach((row) => map.set(row.businessKey!, [...(map.get(row.businessKey!) ?? []), row.rowNumber]));
    map.forEach((rowNumbers) => {
      if (rowNumbers.length < 2) return;
      rowNumbers.forEach((rowNumber) => issues.push(this.issue(rowNumber, '行级业务键', `与第 ${rowNumbers.filter((value) => value !== rowNumber).join('、')} 行冲突`, '补充能区分订单行的物料、项目、站址或金额信息')));
    });
  }

  private detectCostTemplate(workbook: XLSX.WorkBook): string {
    if (this.findSheet(workbook, ['数据id', '所属地市', '审批编号', '本流程内用车里程数'])) return 'mileage_subsidy';
    if (this.findSheet(workbook, ['合同编号', '成本类别', '日期', '金额'])) return 'standard_cost';
    if (this.findSheet(workbook, ['报销项目', '日期', '事由', '金额'])) return 'daily_reimbursement';
    return 'unknown';
  }

  private findSheet(workbook: XLSX.WorkBook, required: string[]) {
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name];
      const first = (XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: false })[0] ?? []).map((value) => this.text(value));
      if (required.every((header) => first.includes(header))) return { name, sheet };
    }
    return null;
  }

  private readWorkbook(buffer: Buffer): XLSX.WorkBook {
    try { return readWorkbookSafe(buffer); }
    catch { throw new BadRequestException('Excel 文件无法解析'); }
  }

  async listBatches(actor: Actor, admin = false, requestedCityId?: number) {
    const cityId = admin ? (requestedCityId ? Number(requestedCityId) : undefined) : this.requireCity(actor);
    const rows = await this.batchRepo.find({
      where: cityId ? { cityId } : {},
      order: { createdAt: 'DESC' },
      take: 100,
    });
    return rows.map((batch) => this.publicBatch(batch));
  }

  async getBatchLineage(id: number, actor: Actor, admin = false) {
    const batch = await this.findScopedBatch(id, actor, admin);
    const [sourceRows, costFacts, orderFacts, versions, operationLogs] = await Promise.all([
      this.sourceRowRepo.find({ where: { importBatchId: batch.id }, order: { rowNumber: 'ASC' } }),
      this.costFactRepo.find({ where: { importBatchId: batch.id }, select: { id: true, sourceRowId: true, versionNo: true } }),
      this.orderFactRepo.find({ where: { importBatchId: batch.id }, select: { id: true, sourceRowId: true, versionNo: true } }),
      this.versionRepo.find({ where: { importBatchId: batch.id }, select: { id: true, factId: true, factType: true, versionNo: true } }),
      this.operationLogRepo.find({ where: { targetType: 'fact_import_batch', targetId: String(batch.id) }, order: { createdAt: 'ASC' } }),
    ]);
    return {
      ...this.publicBatch(batch),
      sourceFileAvailable: Boolean(batch.sourceFileStorageKey && await this.sourceFiles.exists(batch.sourceFileStorageKey)),
      lineage: {
        sourceRows: sourceRows.map((row) => ({ id: row.id, sheetName: row.sheetName, rowNumber: row.rowNumber, status: row.status, rowHash: row.rowHash })),
        costFacts: costFacts.map((fact) => ({ id: fact.id, sourceRowId: fact.sourceRowId, versionNo: fact.versionNo })),
        orderFacts: orderFacts.map((fact) => ({ id: fact.id, sourceRowId: fact.sourceRowId, versionNo: fact.versionNo })),
        factVersions: versions,
        operationLogIds: operationLogs.map((log) => log.id),
      },
    };
  }

  async getSourceFile(id: number, actor: Actor, admin = false) {
    const batch = await this.batchRepo.findOne({ where: { id } });
    if (!batch) {
      await this.auditSourceFileDownload(actor, id, null, 'batch_not_found', 'denied');
      throw new NotFoundException('导入批次不存在或无权访问');
    }
    if (!admin && Number(batch.cityId) !== this.requireCity(actor)) {
      await this.auditSourceFileDownload(actor, id, batch, 'scope_denied', 'denied');
      throw new NotFoundException('导入批次不存在或无权访问');
    }
    if (!batch.sourceFileStorageKey) {
      await this.auditSourceFileDownload(actor, id, batch, 'storage_key_missing', 'failed');
      throw new NotFoundException('该历史批次没有原始文件存储键');
    }
    if (!await this.sourceFiles.exists(batch.sourceFileStorageKey)) {
      await this.auditSourceFileDownload(actor, id, batch, 'source_file_missing', 'failed');
      throw new NotFoundException('原始文件不存在或已超出保留期');
    }
    let buffer: Buffer;
    try {
      buffer = await this.sourceFiles.read(batch.sourceFileStorageKey);
    } catch {
      await this.auditSourceFileDownload(actor, id, batch, 'source_file_read_failed', 'failed');
      throw new NotFoundException('原始文件不存在或无法读取');
    }
    if (this.hash(buffer) !== batch.fileSha256) {
      await this.auditSourceFileDownload(actor, id, batch, 'integrity_failed', 'failed');
      throw new NotFoundException('原始文件完整性校验失败');
    }
    await this.auditSourceFileDownload(actor, id, batch, 'success', 'success');
    return { fileName: batch.sourceFileName, sha256: batch.fileSha256, buffer };
  }

  private async auditSourceFileDownload(
    actor: Actor,
    requestedBatchId: number,
    batch: FactImportBatchEntity | null,
    downloadResult: string,
    resultStatus: 'success' | 'failed' | 'denied',
  ) {
    await this.operationLogRepo.save(this.operationLogRepo.create({
      operatorUserId: actor.userId,
      operatorCityId: actor.cityId,
      actionType: 'fact_source_file_download',
      targetType: 'fact_import_batch',
      targetId: String(requestedBatchId),
      summaryText: `Source file download ${downloadResult} for batch ${requestedBatchId}`,
      beforeDataJson: null,
      afterDataJson: {
        batchId: requestedBatchId,
        batchCityId: batch ? Number(batch.cityId) : null,
        fileSha256: batch?.fileSha256 ?? null,
        storageKey: batch?.sourceFileStorageKey ?? null,
        downloadResult,
      },
      resultStatus,
    }));
  }

  private async findScopedBatch(id: number, actor: Actor, admin: boolean) {
    const where = admin ? { id } : { id, cityId: this.requireCity(actor) };
    const batch = await this.batchRepo.findOne({ where });
    if (!batch) throw new NotFoundException('导入批次不存在或无权访问');
    return batch;
  }

  private publicBatch(batch: FactImportBatchEntity) {
    return {
      id: batch.id,
      factKind: batch.factKind,
      templateType: batch.templateType,
      cityId: Number(batch.cityId),
      operatorUserId: Number(batch.operatorUserId),
      sourceFileName: batch.sourceFileName,
      sourceFileSha256: batch.fileSha256,
      sourceFileStorageKey: batch.sourceFileStorageKey,
      sourceFileSize: batch.sourceFileSize === null ? null : Number(batch.sourceFileSize),
      sourceFileStoredAt: batch.sourceFileStoredAt?.toISOString() ?? null,
      status: batch.status,
      lifecycleStatus: batch.lifecycleStatus,
      totalRows: batch.totalRows,
      successRows: batch.successRows,
      errorRows: batch.errorRows,
      warningCount: batch.warningCount,
      blockingErrorCount: batch.blockingErrorCount,
      errors: batch.errorSummaryJson,
      result: batch.resultSummaryJson,
      uploadedAt: batch.createdAt.toISOString(),
      completedAt: batch.completedAt?.toISOString() ?? null,
      effectiveAt: batch.effectiveAt?.toISOString() ?? null,
    };
  }

  private async ensureEvidence(batch: FactImportBatchEntity, file: Express.Multer.File, evidence: StoredFactSourceFile) {
    if (batch.sourceFileStorageKey) {
      if (!await this.sourceFiles.exists(batch.sourceFileStorageKey)) throw new NotFoundException('幂等批次的原始文件证据缺失');
      return;
    }
    Object.assign(batch, {
      sourceFileName: this.decodeFileName(file.originalname),
      sourceFileStorageKey: evidence.storageKey,
      sourceFileSize: evidence.size,
      sourceFileStoredAt: evidence.storedAt,
    });
    await this.batchRepo.save(batch);
  }

  private async recordUnparsedFailure(
    file: Express.Multer.File,
    actor: Actor,
    factKind: 'cost' | 'order',
    templateType: string,
    hash: string,
    evidence: StoredFactSourceFile,
    error: unknown,
  ): Promise<FactImportResult> {
    const cityId = this.requireCity(actor);
    const issue: FactValidationIssue = {
      rowNumber: 0,
      field: 'file',
      reason: this.errorMessage(error),
      suggestion: '检查文件格式、模板类型、合同选择及必填表头后重新上传',
      severity: 'blocking',
    };
    return this.dataSource.transaction(async (manager) => {
      const batchRepo = manager.getRepository(FactImportBatchEntity);
      const logRepo = manager.getRepository(OperationLogEntity);
      let batch = await batchRepo.findOne({ where: { cityId, factKind, fileSha256: hash } });
      batch = batch ?? batchRepo.create({ factKind, cityId, operatorUserId: actor.userId, fileSha256: hash } as FactImportBatchEntity);
      Object.assign(batch, {
        templateType,
        operatorUserId: actor.userId,
        sourceFileName: this.decodeFileName(file.originalname),
        sourceFileStorageKey: evidence.storageKey,
        sourceFileSize: evidence.size,
        sourceFileStoredAt: evidence.storedAt,
        status: 'failed', lifecycleStatus: 'validation_failed', totalRows: 0, successRows: 0, errorRows: 1,
        warningCount: 0, blockingErrorCount: 1, errorSummaryJson: [issue], resultSummaryJson: null,
        completedAt: new Date(), effectiveAt: null,
      });
      batch = await batchRepo.save(batch);
      await logRepo.save(logRepo.create({
        operatorUserId: actor.userId, operatorCityId: cityId, actionType: `${factKind}_import`, targetType: 'fact_import_batch',
        targetId: String(batch.id), summaryText: `${factKind === 'cost' ? '成本' : '订单'}文件解析失败`, beforeDataJson: null,
        afterDataJson: { batchId: batch.id, fileSha256: hash, storageKey: evidence.storageKey, issue }, resultStatus: 'failed',
      }));
      return this.toResult(batch, false);
    });
  }

  private errorMessage(error: unknown): string {
    if (error instanceof BadRequestException) {
      const response = error.getResponse();
      if (typeof response === 'string') return response;
      const message = (response as { message?: string | string[] }).message;
      if (Array.isArray(message)) return message.join('; ');
      if (message) return message;
    }
    return error instanceof Error ? error.message : String(error);
  }

  private completedBatch(cityId: number, factKind: 'cost' | 'order', hash: string) {
    return this.batchRepo.findOne({ where: { cityId, factKind, fileSha256: hash, status: 'completed' } });
  }

  private toResult(batch: FactImportBatchEntity, idempotent: boolean): FactImportResult {
    return {
      batchId: batch.id, status: batch.lifecycleStatus, idempotent,
      factKind: batch.factKind, templateType: batch.templateType, totalRows: batch.totalRows,
      successRows: batch.successRows, errorRows: batch.errorRows, warningCount: batch.warningCount,
      blockingErrorCount: batch.blockingErrorCount,
      issues: Array.isArray(batch.errorSummaryJson) ? batch.errorSummaryJson as FactValidationIssue[] : [],
    };
  }

  private requireCity(actor: Actor): number {
    if (!actor.cityId) throw new BadRequestException('当前地市账号未绑定地市');
    return Number(actor.cityId);
  }

  private orderBusinessKey(row: ParsedOrder): string {
    const explainable = [row.purchaseOrderNo, row.materialCode, row.projectCode, row.siteCode,
      row.orderedAt.toISOString(), row.taxInclusiveAmount.toFixed(2), row.quantity ?? ''].map((value) => String(value ?? '').trim()).join('|');
    return createHash('sha256').update(explainable).digest('hex');
  }

  private costCategory(value: string): string {
    if (/人工|劳务/.test(value)) return 'labor';
    if (/水|电/.test(value)) return 'utilities';
    if (/油|里程|车辆/.test(value)) return 'fuel';
    if (/招待/.test(value)) return 'entertainment';
    if (/房租|租赁/.test(value)) return 'rent';
    if (/报销|差旅|办公|停车|邮寄/.test(value)) return 'reimbursement';
    return 'other';
  }

  private normalizeCityName(value: string): string {
    return value.replace(/山东省|中国铁塔|总部|\s/g, '').replace(/市分公司|分公司|市$/g, '');
  }
  private number(value: unknown): number | null {
    const text = this.text(value).replace(/,/g, '');
    if (!text) return null;
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }
  private date(value: unknown): Date | null {
    if (value instanceof Date && Number.isFinite(value.getTime())) return value;
    const text = this.text(value).replace(/年|\//g, '-').replace(/月/g, '-').replace(/日/g, '');
    const date = new Date(text);
    return Number.isFinite(date.getTime()) ? date : null;
  }
  private dateString(value: unknown): string | null {
    const date = this.date(value);
    if (!date) return null;
    const y = date.getFullYear(); const m = String(date.getMonth() + 1).padStart(2, '0'); const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  private text(value: unknown): string { return value === null || value === undefined ? '' : String(value).trim(); }
  private nullText(value: unknown): string | null { return this.text(value) || null; }
  private issue(rowNumber: number, field: string, reason: string, suggestion: string, severity: 'warning' | 'blocking' = 'blocking'): FactValidationIssue {
    return { rowNumber, field, reason, suggestion, severity };
  }
  private hash(value: Buffer): string { return createHash('sha256').update(value).digest('hex'); }
  private hashJson(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
  private decodeFileName(value: string): string { try { return Buffer.from(value, 'latin1').toString('utf8'); } catch { return value; } }
}
