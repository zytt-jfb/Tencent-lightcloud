import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import * as XLSX from 'xlsx';
import { WORKBOOK_LIMITS } from '../common/files/workbook-policy';
import { ExportScopeType, ImportJobType, JobStatus, Role } from '@biz-reporting/shared-types';
import type {
  ExportJobResponse,
  ImportJobCancelResponse,
  ImportJobDetail,
  ImportJobListItem,
  ImportJobListResponse,
  ImportQualityIssue,
  ImportQualityIssueType,
  ImportConfirmResponse,
  ImportPreviewResponse,
  ImportJobRetryResponse,
  RecalcRetryResponse,
  RecalcTaskListResponse,
} from '@biz-reporting/shared-types';
import { ContractImportService } from './contract-import.service';
import {
  CreateExportJobRequestDto,
  ConfirmImportRequestDto,
  ImportJobListQueryDto,
  RetryRecalcTaskRequestDto,
} from './ws6.dto';
import { ExportJobEntity } from './export-job.entity';
import { FactSourceFileStorageService } from '../facts/fact-source-file-storage.service';
import { createHash } from 'node:crypto';
import { AnnualPackageEntity } from '../packages/annual-package.entity';
import { ContractMonthRowEntity } from '../packages/contract-month-row.entity';
import { CostMonthRowEntity } from '../packages/cost-month-row.entity';
import { MonthSnapshotEntity } from '../packages/month-snapshot.entity';
import { ImportJobEntity } from './import-job.entity';
import { RecalcTaskEntity } from './recalc-task.entity';
import { ReportingImportScope, ReportingImportService, AtomicityError } from './reporting-import.service';
import { importDiffRequiresOverwrite } from './import-overwrite';
import { CityEntity } from '../cities/city.entity';
import { UserEntity } from '../users/user.entity';
import { OperationLogEntity } from '../common/entities/operation-log.entity';
import {
  assertCityScope,
  checkCityImportAccess,
  isSystemAdmin,
  type RequestUserScope,
} from '../common/security/scope';

export const CITY_COST_IMPORT_JOB_TYPE = ImportJobType.CITY_COST;
type SupportedImportJobType = ImportJobType | typeof CITY_COST_IMPORT_JOB_TYPE;

interface ImportErrorRowInput {
  row?: number;
  message: string;
  originalValue?: string | null;
}

/** 地市端导入作业允许的作业类型白名单（供权限判定复用）。 */
export const CITY_IMPORT_ALLOWED_JOB_TYPES: readonly string[] = [
  ImportJobType.CITY_REPORTING,
  CITY_COST_IMPORT_JOB_TYPE,
];

/** D-04：导入任务最大处理尝试次数（attempt_count 达此值禁止再 retry）。 */
export const MAX_IMPORT_RETRY_ATTEMPTS = 3;

/** D-04：可安全重试的 failureCode 白名单（源文件未受损、幂等可重放）。 */
export const RETRYABLE_FAILURE_CODES: readonly string[] = [
  'IMPORT_ATOMICITY_FAILED',
  'IMPORT_EXECUTE_FAILED',
];

@Injectable()
export class Ws6Service {
  constructor(
    @InjectRepository(ImportJobEntity)
    private readonly importJobRepo: Repository<ImportJobEntity>,
    @InjectRepository(ExportJobEntity)
    private readonly exportJobRepo: Repository<ExportJobEntity>,
    @InjectRepository(RecalcTaskEntity)
    private readonly recalcTaskRepo: Repository<RecalcTaskEntity>,
    @InjectRepository(AnnualPackageEntity)
    private readonly packageRepo: Repository<AnnualPackageEntity>,
    @InjectRepository(ContractMonthRowEntity)
    private readonly contractMonthRepo: Repository<ContractMonthRowEntity>,
    @InjectRepository(CostMonthRowEntity)
    private readonly costMonthRepo: Repository<CostMonthRowEntity>,
    @InjectRepository(MonthSnapshotEntity)
    private readonly snapshotRepo: Repository<MonthSnapshotEntity>,
    @InjectRepository(CityEntity)
    private readonly cityRepo: Repository<CityEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepo: Repository<UserEntity>,
    @InjectRepository(OperationLogEntity)
    private readonly operationLogRepo: Repository<OperationLogEntity>,
    private readonly contractImportService: ContractImportService,
    private readonly reportingImportService: ReportingImportService,
    private readonly sourceFileStorage: FactSourceFileStorageService,
  ) {}

  async createImportJob(data: {
    jobType: SupportedImportJobType;
    operatorUserId: number;
    cityId: number | null;
    reportYear?: number | null;
    sourceFileUrl?: string;
    sourceFileName?: string;
    sourceFileBase64?: string;
    sourceFileBuffer?: Buffer;
  }): Promise<ImportJobEntity> {
    // D-01：buffer 优先（新任务持久存储），hash → store → metadata → DB。
    // 存储失败抛错（不创建有效 job）；base64 仅 legacy 调用方回退。
    let storageKey: string | null = null;
    let sha256: string | null = null;
    let sourceSize: number | null = null;
    let storedAt: Date | null = null;

    if (data.sourceFileBuffer && data.sourceFileBuffer.length > 0) {
      sha256 = createHash('sha256').update(data.sourceFileBuffer).digest('hex');
      sourceSize = data.sourceFileBuffer.length;
      const stored = await this.sourceFileStorage.store(
        data.sourceFileBuffer,
        data.sourceFileName ?? 'import.xlsx',
        sha256,
      );
      storageKey = stored.storageKey;
      storedAt = stored.storedAt;
    }

    const job = this.importJobRepo.create({
      jobType: data.jobType,
      operatorUserId: data.operatorUserId,
      cityId: data.cityId,
      reportYear: data.reportYear ?? null,
      status: JobStatus.PENDING,
      sourceFileUrl: data.sourceFileUrl || '',
      sourceFileName: data.sourceFileName || null,
      sourceFileBase64: data.sourceFileBuffer ? null : (data.sourceFileBase64 || null),
      sourceFileStorageKey: storageKey,
      sourceFileSha256: sha256,
      sourceFileSize: sourceSize,
      sourceFileStoredAt: storedAt,
      parsedSummaryJson: null,
      diffSummaryJson: null,
      errorSummaryJson: null,
    });

    const saved = await this.importJobRepo.save(job);
    saved.sourceFileUrl = `/api/imports/${saved.id}/source-file`;
    const persisted = await this.importJobRepo.save(saved);
    await this.recordImportOperation(persisted, 'import_upload', 'success', `创建导入任务 #${persisted.id}`);
    return persisted;
  }

  async listImportJobs(
    query: ImportJobListQueryDto,
    user: RequestUserScope,
  ): Promise<ImportJobListResponse> {
    const page = query.page || 1;
    const pageSize = query.pageSize || 20;
    // D-02：显式 select 列表所需列，排除 source_file_base64 与三个 JSON 大字段
    // （summary 仅在 detail/preview 等按需加载），控制列表/分页内存。
    const builder = this.importJobRepo
      .createQueryBuilder('job')
      .select([
        'job.id',
        'job.jobType',
        'job.operatorUserId',
        'job.cityId',
        'job.reportYear',
        'job.status',
        'job.sourceFileName',
        'job.sourceFileUrl',
        'job.sourceFileStorageKey',
        'job.confirmedAt',
        'job.createdAt',
        'job.updatedAt',
      ])
      .orderBy('job.created_at', 'DESC')
      .addOrderBy('job.id', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize);

    if (isSystemAdmin(user)) {
      if (query.cityId !== undefined) builder.andWhere('job.city_id = :cityId', { cityId: query.cityId });
    } else {
      if (user.role !== Role.CITY_USER || user.cityId === null) {
        throw new ForbiddenException('当前账号没有可查询的地市范围');
      }
      builder
        .andWhere('job.city_id = :cityId', { cityId: user.cityId })
        .andWhere('job.job_type IN (:...allowedJobTypes)', {
          allowedJobTypes: CITY_IMPORT_ALLOWED_JOB_TYPES,
        });
    }
    if (query.reportYear !== undefined) builder.andWhere('job.report_year = :reportYear', { reportYear: query.reportYear });
    if (query.jobType) builder.andWhere('job.job_type = :jobType', { jobType: query.jobType });
    if (query.status) builder.andWhere('job.status = :status', { status: query.status });

    const [jobs, total] = await builder.getManyAndCount();
    const labels = await this.loadImportJobLabels(jobs);
    return {
      items: jobs.map((job) => this.toImportJobListItem(job, labels)),
      total,
      page,
      pageSize,
    };
  }

  async getImportJobDetail(jobId: number, user: RequestUserScope): Promise<ImportJobDetail> {
    const job = await this.findImportJobOrThrow(jobId);
    this.assertImportJobAccess(job, user);
    const labels = await this.loadImportJobLabels([job]);
    return {
      ...this.toImportJobListItem(job, labels),
      sourceFileUrl: job.sourceFileUrl,
      parsedSummary: job.parsedSummaryJson,
      diffSummary: job.diffSummaryJson,
      errorSummary: job.errorSummaryJson,
      qualityIssues: this.qualityIssuesFromJob(job),
    };
  }

  async previewBoundImport(jobId: number, user: RequestUserScope): Promise<ImportPreviewResponse> {
    let job = await this.findImportJobOrThrow(jobId);
    this.assertImportJobAccess(job, user);
    if (job.status === JobStatus.CANCELLED) throw new BadRequestException('已取消的导入任务不能重新预览');

    if (!job.parsedSummaryJson || job.status === JobStatus.PENDING) {
      // D-04：原子认领 PENDING → PROCESSING（CAS），并发预览仅一个执行。
      const claim = await this.importJobRepo
        .createQueryBuilder()
        .update(ImportJobEntity)
        .set({
          status: JobStatus.PROCESSING,
          attemptCount: () => 'attempt_count + 1',
          processingStartedAt: new Date(),
        })
        .where('id = :id AND status = :pending', { id: jobId, pending: JobStatus.PENDING })
        .execute();
      if (claim.affected === 0) {
        // 并发下另一请求已认领或已完成预览：重新读取后返回现状
        const current = await this.findImportJobOrThrow(jobId);
        if (current.status === JobStatus.CANCELLED) throw new BadRequestException('已取消的导入任务不能重新预览');
        if (current.status === JobStatus.PROCESSING) throw new ConflictException('导入任务正在处理中，请稍候');
        job = current;
      } else {
        job.status = JobStatus.PROCESSING;
        job.attemptCount = Number(job.attemptCount ?? 0) + 1;
      }
      try {
        const parsed = await this.parseImportJob(
          job,
          await this.requireSourceBuffer(job),
          job.cityId,
          job.reportYear ?? new Date().getFullYear(),
        );
        const errors = this.extractErrorRows(parsed);
        job.parsedSummaryJson = parsed;
        job.diffSummaryJson = this.extractDiffSummary(parsed);
        job.errorSummaryJson = this.errorSummaryFromRows(errors);
        job.status = JobStatus.PREVIEWED;
        await this.importJobRepo.save(job);
        await this.recordImportOperation(
          job,
          'import_preview',
          errors.length > 0 ? 'blocked' : 'success',
          errors.length > 0 ? `导入任务 #${job.id} 预览发现 ${errors.length} 个阻塞问题` : `导入任务 #${job.id} 预览通过`,
        );
      } catch (error) {
        job.status = JobStatus.FAILED;
        job.errorSummaryJson = this.errorSummaryFromRows([{ message: this.errorMessage(error) }]);
        await this.importJobRepo.save(job);
        await this.recordImportOperation(job, 'import_preview', 'failed', this.errorMessage(error));
        throw error;
      }
    }

    return {
      id: job.id,
      status: job.status,
      parsedSummary: job.parsedSummaryJson,
      diffSummary: job.diffSummaryJson,
      errorSummary: job.errorSummaryJson,
      qualityIssues: this.qualityIssuesFromJob(job),
    };
  }

  async confirmBoundImport(
    jobId: number,
    user: RequestUserScope,
    confirmOverwrite: boolean,
  ): Promise<ImportConfirmResponse> {
    let job = await this.findImportJobOrThrow(jobId);
    this.assertImportJobAccess(job, user);
    if (job.status === JobStatus.COMPLETED) {
      return { success: true, jobId: job.id, status: job.status, alreadyConfirmed: true };
    }
    if (![JobStatus.PENDING, JobStatus.PREVIEWED].includes(job.status as JobStatus)) {
      throw new BadRequestException(`导入任务 #${jobId} 当前状态为 ${job.status}，不可确认`);
    }

    const preview = await this.previewBoundImport(jobId, user);
    job = await this.findImportJobOrThrow(jobId);
    const qualityIssues = preview.qualityIssues ?? [];
    if (qualityIssues.some((issue) => issue.blocking)) {
      await this.recordImportOperation(job, 'import_confirm', 'blocked', `导入任务 #${job.id} 因质量问题被阻止写入`);
      throw new BadRequestException('预览存在阻塞性质量问题，修复源文件后请重新创建导入任务');
    }
    if (!confirmOverwrite && importDiffRequiresOverwrite(job.diffSummaryJson)) {
      throw new BadRequestException('预览结果包含将被覆盖的数据，请明确确认覆盖后再继续导入');
    }

    // D-04：preview/overwrite 检查后原子认领 PENDING|PREVIEWED → PROCESSING（CAS），
    // 20 并发 confirm 最多一个执行；attempt_count 递增、processing_started_at 记录。
    const claim = await this.importJobRepo
      .createQueryBuilder()
      .update(ImportJobEntity)
      .set({
        status: JobStatus.PROCESSING,
        attemptCount: () => 'attempt_count + 1',
        processingStartedAt: new Date(),
      })
      .where('id = :id AND status IN (:...claimable)', {
        id: jobId,
        claimable: [JobStatus.PENDING, JobStatus.PREVIEWED],
      })
      .execute();
    if (claim.affected === 0) {
      const current = await this.findImportJobOrThrow(jobId);
      if (current.status === JobStatus.COMPLETED) {
        return { success: true, jobId: current.id, status: current.status, alreadyConfirmed: true };
      }
      if (current.status === JobStatus.PROCESSING) {
        throw new ConflictException('导入任务正在处理中，请勿重复确认');
      }
      throw new BadRequestException(`导入任务 #${jobId} 当前状态为 ${current.status}，不可确认`);
    }
    job.status = JobStatus.PROCESSING;
    job.attemptCount = Number(job.attemptCount ?? 0) + 1;
    job.processingStartedAt = new Date();

    try {
      const buffer = await this.requireSourceBuffer(job);
      const reportYear = job.reportYear ?? new Date().getFullYear();
      let successCount = 0;
      let resultErrors: ImportErrorRowInput[] = [];
      let parsedSummary: Record<string, unknown> | null = null;
      if (job.jobType === ImportJobType.CONTRACT) {
        const result = await this.contractImportService.execute(buffer, job.operatorUserId, job.sourceFileName);
        successCount = result.successCount;
        resultErrors = result.errors;
        parsedSummary = result as unknown as Record<string, unknown>;
      } else {
        const scope = job.jobType === CITY_COST_IMPORT_JOB_TYPE ? ReportingImportScope.COST : ReportingImportScope.ALL;
        const result = await this.reportingImportService.execute(
          buffer,
          reportYear,
          job.operatorUserId,
          job.sourceFileName,
          job.cityId,
          scope,
        );
        successCount = result.successCount;
        resultErrors = result.errors;
        parsedSummary = result as unknown as Record<string, unknown>;
      }

      job.parsedSummaryJson = parsedSummary;
      job.errorSummaryJson = this.errorSummaryFromRows(resultErrors);
      if (successCount <= 0 || resultErrors.length > 0) {
        job.status = JobStatus.FAILED;
        if (!job.errorSummaryJson) job.errorSummaryJson = this.errorSummaryFromRows([{ message: '没有可导入的数据' }]);
        await this.importJobRepo.save(job);
        await this.recordImportOperation(job, 'import_confirm', 'failed', `导入任务 #${job.id} 未写入业务数据`);
        return { success: false, jobId: job.id, status: job.status, alreadyConfirmed: false };
      }
      job.status = JobStatus.COMPLETED;
      job.confirmedAt = new Date();
      await this.importJobRepo.save(job);
      await this.recordImportOperation(job, 'import_confirm', 'success', `导入任务 #${job.id} 已写入 ${successCount} 条数据`);
      return { success: true, jobId: job.id, status: job.status, alreadyConfirmed: false };
    } catch (error) {
      // D-03：AtomicityError = 事务已整体回滚（零写入），事务外保存 FAILED 摘要与 failureCode；
      // successCount 不得对外返回（回滚后无已写入数据）。
      job.status = JobStatus.FAILED;
      if (error instanceof AtomicityError) {
        job.errorSummaryJson = this.errorSummaryFromRows(error.errors.map((e) => ({ row: e.row, message: e.message })));
        job.failureCode = 'IMPORT_ATOMICITY_FAILED';
      } else {
        job.errorSummaryJson = this.errorSummaryFromRows([{ message: this.errorMessage(error) }]);
        job.failureCode = 'IMPORT_EXECUTE_FAILED';
      }
      await this.importJobRepo.save(job);
      await this.recordImportOperation(job, 'import_confirm', 'failed', this.errorMessage(error));
      throw error;
    }
  }

  async cancelImportJob(jobId: number, user: RequestUserScope): Promise<ImportJobCancelResponse> {
    const job = await this.findImportJobOrThrow(jobId);
    this.assertImportJobAccess(job, user);
    if (job.status === JobStatus.CANCELLED) return { success: true, jobId: job.id, status: job.status };
    if ([JobStatus.COMPLETED, JobStatus.FAILED].includes(job.status as JobStatus)) {
      throw new BadRequestException(`状态为 ${job.status} 的导入任务不可取消`);
    }
    job.status = JobStatus.CANCELLED;
    await this.importJobRepo.save(job);
    await this.recordImportOperation(job, 'import_cancel', 'success', `取消导入任务 #${job.id}`);
    return { success: true, jobId: job.id, status: job.status };
  }

  /**
   * D-04：导入任务受控重试（FAILED → PENDING）。
   * 限制：仅 FAILED、attempt < MAX、failureCode 在白名单、源文件可读（storage 或 legacy base64）。
   * legacy 无 storage metadata 且 base64 不可读 → LEGACY_REVIEW_REQUIRED（人工复核，不自动重试）。
   */
  async retryImportJob(jobId: number, user: RequestUserScope): Promise<ImportJobRetryResponse> {
    const job = await this.findImportJobOrThrow(jobId);
    this.assertImportJobAccess(job, user);
    if (job.status !== JobStatus.FAILED) {
      throw new BadRequestException(`仅 FAILED 状态可重试，当前状态为 ${job.status}`);
    }
    if (Number(job.attemptCount ?? 0) >= MAX_IMPORT_RETRY_ATTEMPTS) {
      throw new BadRequestException(`已达最大重试次数（${MAX_IMPORT_RETRY_ATTEMPTS}），请重新创建导入任务`);
    }
    if (job.failureCode && !RETRYABLE_FAILURE_CODES.includes(job.failureCode)) {
      throw new BadRequestException(`错误码 ${job.failureCode} 不可自动重试，请人工复核`);
    }
    // 源文件可读性：storage metadata 完整 或 legacy base64 可回退读取
    let sourceReadable = !!job.sourceFileStorageKey;
    if (!sourceReadable) {
      const withBase64 = await this.importJobRepo
        .createQueryBuilder('job')
        .addSelect('job.sourceFileBase64')
        .where('job.id = :id', { id: jobId })
        .getOne();
      sourceReadable = !!withBase64?.sourceFileBase64;
    }
    if (!sourceReadable) {
      throw new BadRequestException('LEGACY_REVIEW_REQUIRED: 任务缺少可读源文件，请人工复核后重新创建导入任务');
    }

    job.status = JobStatus.PENDING;
    job.failureCode = null;
    job.errorSummaryJson = null;
    await this.importJobRepo.save(job);
    await this.recordImportOperation(job, 'import_retry', 'success', `导入任务 #${job.id} 已重置为待处理`);
    return { success: true, jobId: job.id, status: job.status };
  }

  async getImportPreview(
    jobId: number,
    cityId: number | null | undefined,
    reportYear: number | null | undefined,
    user: RequestUserScope,
  ): Promise<ImportPreviewResponse> {
    const job = await this.findImportJobOrThrow(jobId);
    this.assertImportJobAccess(job, user);
    const scopedCityId = isSystemAdmin(user) ? cityId ?? job.cityId : user.cityId;
    if (job.status === JobStatus.PENDING || !job.parsedSummaryJson) {
      const fileBuffer = await this.requireSourceBuffer(job);
      const parsedSummary = await this.parseImportJob(
        job,
        fileBuffer,
        scopedCityId,
        reportYear ?? new Date().getFullYear(),
      );
      const errors = this.extractErrors(parsedSummary);
      job.parsedSummaryJson = parsedSummary;
      job.diffSummaryJson = this.extractDiffSummary(parsedSummary);
      job.errorSummaryJson = errors.length > 0 ? { errors } : null;
      await this.importJobRepo.save(job);
    }

    return {
      id: job.id,
      status: job.status,
      parsedSummary: job.parsedSummaryJson,
      diffSummary: job.diffSummaryJson,
      errorSummary: job.errorSummaryJson,
    };
  }

  async confirmImport(
    jobId: number,
    dto: ConfirmImportRequestDto,
    user: RequestUserScope,
  ): Promise<ImportConfirmResponse> {
    const job = await this.findImportJobOrThrow(jobId);
    this.assertImportJobAccess(job, user);
    if (job.status !== JobStatus.PENDING) {
      throw new BadRequestException(`导入任务 #${jobId} 当前状态为 ${job.status}，仅 pending 状态可确认`);
    }

    const fileBuffer = await this.requireSourceBuffer(job);
    const reportYear = dto.reportYear ?? new Date().getFullYear();
    const forcedCityId = isSystemAdmin(user) ? dto.cityId ?? job.cityId ?? null : user.cityId;
    const preview = await this.parseImportJob(job, fileBuffer, forcedCityId, reportYear);
    job.parsedSummaryJson = preview;
    job.diffSummaryJson = this.extractDiffSummary(preview);
    job.errorSummaryJson = this.errorSummaryFromRows(
      this.extractErrors(preview).map((message) => ({ message })),
    );
    await this.importJobRepo.save(job);
    if (!dto.confirmOverwrite && importDiffRequiresOverwrite(job.diffSummaryJson)) {
      throw new BadRequestException('预览结果包含将被覆盖的数据，请确认覆盖后再继续导入');
    }
    // D-04：旧路径同样原子认领 PENDING → PROCESSING（CAS），并发 confirm 仅一个执行。
    const claim = await this.importJobRepo
      .createQueryBuilder()
      .update(ImportJobEntity)
      .set({
        status: JobStatus.PROCESSING,
        attemptCount: () => 'attempt_count + 1',
        processingStartedAt: new Date(),
      })
      .where('id = :id AND status = :pending', { id: jobId, pending: JobStatus.PENDING })
      .execute();
    if (claim.affected === 0) {
      const current = await this.findImportJobOrThrow(jobId);
      if (current.status === JobStatus.COMPLETED) {
        return { success: true, jobId: current.id, status: current.status, alreadyConfirmed: true };
      }
      if (current.status === JobStatus.PROCESSING) {
        throw new ConflictException('导入任务正在处理中，请勿重复确认');
      }
      throw new BadRequestException(`导入任务 #${jobId} 当前状态为 ${current.status}，不可确认`);
    }
    job.status = JobStatus.PROCESSING;
    job.attemptCount = Number(job.attemptCount ?? 0) + 1;
    job.processingStartedAt = new Date();
    try {
      let successCount = 0;
      let errors: Array<{ row?: number; message: string }> = [];
      let parsedSummary: Record<string, unknown> | null = null;

      if (job.jobType === ImportJobType.CONTRACT) {
        const result = await this.contractImportService.execute(fileBuffer, job.operatorUserId, job.sourceFileName);
        successCount = result.successCount;
        errors = result.errors;
        parsedSummary = result as unknown as Record<string, unknown>;
      } else if (
        job.jobType === ImportJobType.CITY_REPORTING
        || job.jobType === CITY_COST_IMPORT_JOB_TYPE
      ) {
        const scope = job.jobType === CITY_COST_IMPORT_JOB_TYPE
          ? ReportingImportScope.COST
          : ReportingImportScope.ALL;
        const result = await this.reportingImportService.execute(
          fileBuffer,
          reportYear,
          job.operatorUserId,
          job.sourceFileName,
          forcedCityId,
          scope,
        );
        successCount = result.successCount;
        errors = result.errors;
        parsedSummary = result as unknown as Record<string, unknown>;
      }

      job.parsedSummaryJson = parsedSummary;
      job.errorSummaryJson = this.errorSummaryFromRows(errors);
      // D-03（IMP-2）：与新路径 confirmBoundImport 统一——任一错误即 FAILED，
      // 禁止「部分成功+有错误」仍标 COMPLETED。
      if (successCount <= 0 || errors.length > 0) {
        job.status = JobStatus.FAILED;
        job.errorSummaryJson = this.errorSummaryFromRows(errors.length > 0 ? errors : [{ message: '没有可导入的数据' }]);
        await this.importJobRepo.save(job);
        return { success: false, jobId: job.id };
      }

      job.status = JobStatus.COMPLETED;
      job.confirmedAt = new Date();
      await this.importJobRepo.save(job);
      return { success: true, jobId: job.id };
    } catch (error) {
      // D-03：AtomicityError = 事务已整体回滚，事务外保存 FAILED 摘要 + failureCode（同 confirmBoundImport）
      job.status = JobStatus.FAILED;
      if (error instanceof AtomicityError) {
        job.errorSummaryJson = this.errorSummaryFromRows(error.errors.map((e) => ({ row: e.row, message: e.message })));
        job.failureCode = 'IMPORT_ATOMICITY_FAILED';
      } else {
        job.errorSummaryJson = { errors: [this.errorMessage(error)] };
        job.failureCode = 'IMPORT_EXECUTE_FAILED';
      }
      await this.importJobRepo.save(job);
      throw error;
    }
  }

  async getImportSourceFile(
    jobId: number,
    user: RequestUserScope,
  ): Promise<{ buffer: Buffer; fileName: string; contentType: string }> {
    const job = await this.findImportJobOrThrow(jobId);
    this.assertImportJobAccess(job, user);
    const buffer = await this.requireSourceBuffer(job);
    const fileName = job.sourceFileName || `import-${job.id}.xlsx`;
    const ext = (fileName.split('.').pop() || '').toLowerCase();
    const contentType = ext === 'csv'
      ? 'text/csv; charset=utf-8'
      : ext === 'xls'
        ? 'application/vnd.ms-excel'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    return { buffer, fileName, contentType };
  }

  async createExportJob(
    data: CreateExportJobRequestDto,
    user: RequestUserScope,
  ): Promise<ExportJobEntity> {
    const cityId = isSystemAdmin(user) ? data.cityId ?? null : user.cityId;
    if (!isSystemAdmin(user) && (data.scopeType !== ExportScopeType.CITY || cityId === null)) {
      throw new ForbiddenException('City users can only export their own city');
    }
    assertCityScope(user, cityId);
    const job = this.exportJobRepo.create({
      operatorUserId: user.userId,
      exportMode: data.exportMode,
      scopeType: data.scopeType,
      cityId,
      reportYear: data.reportYear,
      belongMonth: data.belongMonth ?? null,
      snapshotRange: data.snapshotRange ?? null,
      status: JobStatus.PENDING,
    });
    const saved = await this.exportJobRepo.save(job);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);
    saved.status = JobStatus.COMPLETED;
    saved.fileUrl = '';
    saved.expiresAt = expiresAt;
    return this.exportJobRepo.save(saved);
  }

  async getExportFile(
    jobId: number,
    user: RequestUserScope,
  ): Promise<{ buffer: Buffer; fileName: string; contentType: string }> {
    const job = await this.exportJobRepo.findOne({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Export job not found');
    // E-01：下载要求 COMPLETED、未过期、operator/role/city scope；五类访问全部审计
    if (job.expiresAt && new Date(job.expiresAt).getTime() < Date.now()) {
      await this.auditExportDownload(jobId, user, 'expired', 'EXPORT_EXPIRED');
      throw new BadRequestException('导出文件已过期，请重新导出');
    }
    if (job.status !== JobStatus.COMPLETED) {
      await this.auditExportDownload(jobId, user, 'failed', `EXPORT_NOT_READY:${job.status}`);
      throw new BadRequestException('导出任务未完成，无法下载');
    }
    if (!isSystemAdmin(user) && job.operatorUserId !== user.userId) {
      await this.auditExportDownload(jobId, user, 'denied', 'EXPORT_FORBIDDEN');
      throw new ForbiddenException('No permission to view this export job');
    }
    assertCityScope(user, job.cityId);

    try {
      const packages = await this.packageRepo.find({ where: { reportYear: job.reportYear } });
    const scopedPackages = packages.filter((pkg) => job.cityId === null || Number(pkg.cityId) === Number(job.cityId));
    const packageIds = scopedPackages.map((pkg) => Number(pkg.id));
    const packageMap = new Map(scopedPackages.map((pkg) => [Number(pkg.id), pkg]));
    const rows: Array<Record<string, string | number | null>> = [];

    if (packageIds.length > 0 && job.exportMode === 'month_snapshot') {
      const snapshots = await this.snapshotRepo.find({ where: { packageId: In(packageIds) } });
      for (const snapshot of snapshots) {
        if (job.belongMonth !== null && Number(snapshot.belongMonth) !== Number(job.belongMonth)) continue;
        const contractRows: unknown = snapshot.contractRowsJson;
        if (Array.isArray(contractRows)) {
          for (const value of contractRows) {
            if (!this.isRecord(value)) continue;
            rows.push(this.toExportRow('contract_snapshot', snapshot.cityId, snapshot.belongMonth, value));
          }
        }
        const costRows: unknown = snapshot.costRowsJson;
        if (Array.isArray(costRows)) {
          for (const value of costRows) {
            if (!this.isRecord(value)) continue;
            rows.push(this.toExportRow('cost_snapshot', snapshot.cityId, snapshot.belongMonth, value));
          }
        }
      }
    } else if (packageIds.length > 0) {
      const realtimeMonth = job.belongMonth ?? new Date().getMonth() + 1;
      const [contractRows, costRows] = await Promise.all([
        this.contractMonthRepo.find({ where: { packageId: In(packageIds) } }),
        this.costMonthRepo.find({ where: { packageId: In(packageIds) } }),
      ]);
      for (const row of contractRows) {
        if (Number(row.monthNo) !== Number(realtimeMonth)) continue;
        const pkg = packageMap.get(Number(row.packageId));
        rows.push({
          recordType: 'contract',
          cityId: pkg?.cityId ?? null,
          monthNo: row.monthNo,
          contractId: row.contractId,
          contractCode: row.contractCodeSnapshot,
          contractName: row.contractNameSnapshot,
          completionAmount: this.toExportNumber(row.completionAmount),
          acceptanceAmount: this.toExportNumber(row.acceptanceAmount),
          invoiceAmount: this.toExportNumber(row.invoiceAmount),
          orderAmount: this.toExportNumber(row.orderAmount),
        });
      }
      for (const row of costRows) {
        if (Number(row.monthNo) !== Number(realtimeMonth)) continue;
        const pkg = packageMap.get(Number(row.packageId));
        rows.push({
          recordType: 'cost',
          cityId: pkg?.cityId ?? null,
          monthNo: row.monthNo,
          costCategoryCode: row.costCategoryCode,
          amount: this.toExportNumber(row.amount),
        });
      }
    }

    // D-05：同步导出超过 100k 行拒绝生成（防止大导出拖垮同步请求）
    if (rows.length > WORKBOOK_LIMITS.maxRowsPerSheet) {
      throw new BadRequestException(`导出行数（${rows.length}）超过上限 ${WORKBOOK_LIMITS.maxRowsPerSheet}，请缩小范围后重试`);
    }
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(rows);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'reporting');
    const buffer = Buffer.from(XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }));
      await this.auditExportDownload(jobId, user, 'success', 'EXPORT_DOWNLOAD_OK');
      return {
        buffer,
        fileName: `business-report-${job.reportYear}-${job.belongMonth ?? 'year'}.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    } catch (error) {
      await this.auditExportDownload(jobId, user, 'failed', 'EXPORT_GENERATE_FAILED');
      throw error;
    }
  }

  /** E-01：导出下载审计（success/denied/expired/failed）。审计失败不阻断下载主流程。 */
  private async auditExportDownload(
    jobId: number,
    user: RequestUserScope,
    result: 'success' | 'denied' | 'expired' | 'failed',
    reasonCode: string,
  ): Promise<void> {
    const label = result === 'success' ? '成功' : result === 'denied' ? '被拒绝' : result === 'expired' ? '已过期' : '失败';
    try {
      await this.operationLogRepo.save(this.operationLogRepo.create({
        operatorUserId: user.userId,
        operatorCityId: user.cityId,
        actionType: 'export_download',
        targetType: 'export_job',
        targetId: String(jobId),
        summaryText: `导出文件下载${label}（${reasonCode}）`,
        resultStatus: result,
        beforeDataJson: null,
        afterDataJson: { jobId, reasonCode },
      }));
    } catch {
      // 审计写失败不阻断下载（与导入审计的失败关闭策略不同——导出为只读场景）
    }
  }
  async getExportJob(
    jobId: number,
    user: RequestUserScope,
  ): Promise<ExportJobResponse> {
    const job = await this.exportJobRepo.findOne({ where: { id: jobId } });
    if (!job) throw new NotFoundException(`导出任务 #${jobId} 不存在`);
    if (!isSystemAdmin(user) && job.operatorUserId !== user.userId) {
      throw new ForbiddenException('No permission to view this export job');
    }
    assertCityScope(user, job.cityId);
    return {
      id: job.id,
      status: job.status,
      fileUrl: `/exports/${job.id}/download`,
      expiresAt: job.expiresAt,
      createdAt: job.createdAt,
    };
  }

  async listRecalcTasks(): Promise<RecalcTaskListResponse> {
    const tasks = await this.recalcTaskRepo.find({ order: { createdAt: 'DESC' } });
    const items = tasks.map((task) => ({
      id: task.id,
      taskType: task.taskType,
      status: task.status,
      errorMessage: task.errorMessage,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    }));
    return { items, total: items.length };
  }

  async retryRecalcTask(taskId: number, _dto: RetryRecalcTaskRequestDto): Promise<RecalcRetryResponse> {
    const task = await this.recalcTaskRepo.findOne({ where: { id: taskId } });
    if (!task) throw new NotFoundException(`重算任务 #${taskId} 不存在`);
    if (task.status !== JobStatus.FAILED) {
      throw new BadRequestException(`重算任务 #${taskId} 当前状态为 ${task.status}，仅 failed 状态可重试`);
    }
    task.status = JobStatus.PENDING;
    task.errorMessage = null;
    await this.recalcTaskRepo.save(task);
    return { success: true, taskId: task.id };
  }


  private toExportNumber(value: unknown): number {
    const numberValue = Number(value ?? 0);
    return Number.isFinite(numberValue) ? numberValue : 0;
  }

  private toExportRow(
    recordType: string,
    cityId: number,
    monthNo: number,
    value: Record<string, unknown>,
  ): Record<string, string | number | null> {
    return {
      recordType,
      cityId,
      monthNo,
      contractId: this.toExportNumber(value.contractId),
      contractCode: typeof value.contractCode === 'string' ? value.contractCode : null,
      contractName: typeof value.contractName === 'string' ? value.contractName : null,
      completionAmount: this.toExportNumber(value.completionAmount),
      acceptanceAmount: this.toExportNumber(value.acceptanceAmount),
      invoiceAmount: this.toExportNumber(value.invoiceAmount),
      orderAmount: this.toExportNumber(value.orderAmount),
      costCategoryCode: typeof value.costCategoryCode === 'string' ? value.costCategoryCode : null,
      amount: this.toExportNumber(value.amount),
    };
  }
  // ============================================================
  // 地市端导入作业（新接口）：身份链以 job 自身绑定的 city_id / report_year / operator 为准，
  // 预览/确认不再依赖前端回传 cityId / reportYear。
  // ============================================================

  private assertCityImportAccess(job: ImportJobEntity, user: RequestUserScope): void {
    const result = checkCityImportAccess({
      userRole: user.role,
      userId: user.userId,
      userCityId: user.cityId,
      jobType: job.jobType,
      jobCityId: job.cityId,
      jobOperatorUserId: job.operatorUserId,
      allowedJobTypes: CITY_IMPORT_ALLOWED_JOB_TYPES,
    });
    if (!result.ok) {
      throw new ForbiddenException(result.reason);
    }
  }

  async getCityImportJob(jobId: number, user: RequestUserScope): Promise<ImportJobDetail> {
    return this.getImportJobDetail(jobId, user);
  }

  async previewCityImport(jobId: number, user: RequestUserScope): Promise<ImportPreviewResponse> {
    return this.previewBoundImport(jobId, user);
  }

  async confirmCityImport(
    jobId: number,
    user: RequestUserScope,
    confirmOverwrite: boolean,
  ): Promise<ImportConfirmResponse> {
    return this.confirmBoundImport(jobId, user, confirmOverwrite);
  }

  async cancelCityImport(jobId: number, user: RequestUserScope): Promise<ImportJobCancelResponse> {
    return this.cancelImportJob(jobId, user);
  }

  // 系统管理员可访问全部任务；地市用户仅可访问本地市、本人 operator 的报表和成本任务。
  // D-02：统一入口 —— 非管理员一律走 checkCityImportAccess（含 operator 归属检查），
  // 确保 detail/preview/confirm/cancel/download 共用同一权限判定。
  private assertImportJobAccess(job: ImportJobEntity, user: RequestUserScope): void {
    if (isSystemAdmin(user)) return;
    const result = checkCityImportAccess({
      userRole: user.role,
      userId: user.userId,
      userCityId: user.cityId,
      jobType: job.jobType,
      jobCityId: job.cityId,
      jobOperatorUserId: job.operatorUserId,
      allowedJobTypes: CITY_IMPORT_ALLOWED_JOB_TYPES,
    });
    if (!result.ok) {
      throw new ForbiddenException(result.reason);
    }
  }

  private async findImportJobOrThrow(jobId: number): Promise<ImportJobEntity> {
    const job = await this.importJobRepo.findOne({ where: { id: jobId } });
    if (!job) throw new NotFoundException(`导入任务 #${jobId} 不存在`);
    return job;
  }

  private async requireSourceBuffer(job: ImportJobEntity): Promise<Buffer> {
    // D-01：持久存储优先（storage key + sha256 校验）；legacy base64 显式 addSelect 回退。
    if (job.sourceFileStorageKey) {
      const buf = await this.sourceFileStorage.read(job.sourceFileStorageKey);
      if (job.sourceFileSha256) {
        const actual = createHash('sha256').update(buf).digest('hex');
        if (actual !== job.sourceFileSha256) {
          throw new BadRequestException(`导入任务 #${job.id} 源文件哈希校验失败`);
        }
      }
      return buf;
    }
    if (job.sourceFileBase64) {
      return Buffer.from(job.sourceFileBase64, 'base64');
    }
    // base64 已设 select:false：未随普通查询加载时显式回退读取
    const withBase64 = await this.importJobRepo
      .createQueryBuilder('job')
      .addSelect('job.sourceFileBase64')
      .where('job.id = :id', { id: job.id })
      .getOne();
    if (withBase64?.sourceFileBase64) {
      return Buffer.from(withBase64.sourceFileBase64, 'base64');
    }
    throw new BadRequestException(`导入任务 #${job.id} 没有可读取的文件数据`);
  }

  private async parseImportJob(
    job: ImportJobEntity,
    fileBuffer: Buffer,
    cityId: number | null | undefined,
    reportYear: number,
  ): Promise<Record<string, unknown>> {
    if (job.jobType === ImportJobType.CONTRACT) {
      const result = await this.contractImportService.preview(fileBuffer, job.sourceFileName);
      return result as unknown as Record<string, unknown>;
    }
    if (
      job.jobType === ImportJobType.CITY_REPORTING
      || job.jobType === CITY_COST_IMPORT_JOB_TYPE
    ) {
      const scope = job.jobType === CITY_COST_IMPORT_JOB_TYPE
        ? ReportingImportScope.COST
        : ReportingImportScope.ALL;
      const result = await this.reportingImportService.preview(
        fileBuffer,
        job.sourceFileName,
        cityId,
        reportYear,
        scope,
      );
      return result as unknown as Record<string, unknown>;
    }
    throw new BadRequestException(`不支持的导入类型：${job.jobType}`);
  }

  private extractErrors(parsedSummary: Record<string, unknown>): string[] {
    return this.extractErrorRows(parsedSummary)
      .map((item) => `${item.row ? `第${item.row}行：` : ''}${item.message}`);
  }

  private extractErrorRows(parsedSummary: Record<string, unknown>): ImportErrorRowInput[] {
    const errors = parsedSummary.errors;
    if (!Array.isArray(errors)) return [];
    return errors
      .map((item): ImportErrorRowInput | null => {
        if (!this.isRecord(item)) {
          const message = String(item).trim();
          return message ? { message } : null;
        }
        const message = typeof item.message === 'string' ? item.message.trim() : JSON.stringify(item);
        if (!message) return null;
        return {
          row: typeof item.row === 'number' && item.row > 0 ? item.row : undefined,
          message,
          originalValue: typeof item.originalValue === 'string' ? item.originalValue : null,
        };
      })
      .filter((item): item is ImportErrorRowInput => item !== null);
  }

  private extractDiffSummary(parsedSummary: Record<string, unknown>): Record<string, unknown> | null {
    return this.isRecord(parsedSummary.diffSummary) ? parsedSummary.diffSummary : null;
  }

  private errorSummaryFromRows(rows: ImportErrorRowInput[]): Record<string, unknown> | null {
    if (rows.length === 0) return null;
    return {
      errors: rows.map((row) => `${row.row ? `第${row.row}行：` : ''}${row.message}`),
      issues: rows.map((row, index) => this.toQualityIssue(row, index)),
    };
  }

  private qualityIssuesFromJob(job: ImportJobEntity): ImportQualityIssue[] {
    const issues = job.errorSummaryJson?.issues;
    if (Array.isArray(issues)) {
      return issues.filter((item): item is ImportQualityIssue => this.isQualityIssue(item));
    }
    if (!job.parsedSummaryJson) return [];
    return this.extractErrorRows(job.parsedSummaryJson)
      .map((row, index) => this.toQualityIssue(row, index));
  }

  private toQualityIssue(row: ImportErrorRowInput, index: number): ImportQualityIssue {
    const issueType = this.classifyQualityIssue(row.message);
    return {
      id: `issue-${index + 1}`,
      issueType,
      severity: 'blocking',
      rowNo: row.row ?? null,
      sourceLocation: row.row ? `第 ${row.row} 行` : '文件级校验',
      originalValue: row.originalValue ?? null,
      description: row.message,
      blocking: true,
      suggestedOwner: issueType === 'scope' || issueType === 'mapping'
        ? Role.SYSTEM_ADMIN
        : Role.CITY_USER,
    };
  }

  private classifyQualityIssue(message: string): ImportQualityIssueType {
    if (/模板|表头|工作表|sheet/i.test(message)) return 'template';
    if (/合同|映射|不存在|未分配/.test(message)) return 'mapping';
    if (/重复/.test(message)) return 'duplicate';
    if (/地市|权限|范围/.test(message)) return 'scope';
    if (/格式|解析|数值|日期/.test(message)) return 'parse';
    return 'validation';
  }

  private isQualityIssue(value: unknown): value is ImportQualityIssue {
    return this.isRecord(value)
      && typeof value.id === 'string'
      && typeof value.issueType === 'string'
      && typeof value.severity === 'string'
      && typeof value.sourceLocation === 'string'
      && typeof value.description === 'string'
      && typeof value.blocking === 'boolean'
      && typeof value.suggestedOwner === 'string';
  }

  private async loadImportJobLabels(jobs: ImportJobEntity[]): Promise<{
    cityNames: Map<number, string>;
    userNames: Map<number, string>;
  }> {
    const cityIds = [...new Set(jobs.map((job) => job.cityId).filter((id): id is number => id !== null))];
    const userIds = [...new Set(jobs.map((job) => Number(job.operatorUserId)))];
    const [cities, users] = await Promise.all([
      cityIds.length > 0 ? this.cityRepo.find({ where: { id: In(cityIds) } }) : Promise.resolve([]),
      userIds.length > 0 ? this.userRepo.find({ where: { id: In(userIds) } }) : Promise.resolve([]),
    ]);
    return {
      cityNames: new Map(cities.map((city) => [Number(city.id), city.name])),
      userNames: new Map(users.map((user) => [Number(user.id), user.name])),
    };
  }

  private toImportJobListItem(
    job: ImportJobEntity,
    labels: { cityNames: Map<number, string>; userNames: Map<number, string> },
  ): ImportJobListItem {
    return {
      id: Number(job.id),
      jobType: job.jobType,
      operatorUserId: Number(job.operatorUserId),
      operatorName: labels.userNames.get(Number(job.operatorUserId)) ?? null,
      cityId: job.cityId === null ? null : Number(job.cityId),
      cityName: job.cityId === null ? null : labels.cityNames.get(Number(job.cityId)) ?? null,
      reportYear: job.reportYear,
      status: job.status,
      sourceFileName: job.sourceFileName,
      confirmedAt: job.confirmedAt ? new Date(job.confirmedAt).toISOString() : null,
      createdAt: new Date(job.createdAt).toISOString(),
      updatedAt: new Date(job.updatedAt).toISOString(),
    };
  }

  private async recordImportOperation(
    job: ImportJobEntity,
    actionType: string,
    resultStatus: string,
    summaryText: string,
  ): Promise<void> {
    const log = this.operationLogRepo.create({
      operatorUserId: Number(job.operatorUserId),
      operatorCityId: job.cityId === null ? null : Number(job.cityId),
      actionType,
      targetType: 'import_job',
      targetId: String(job.id),
      summaryText,
      beforeDataJson: null,
      afterDataJson: {
        status: job.status,
        jobType: job.jobType,
        reportYear: job.reportYear,
        confirmedAt: job.confirmedAt,
      },
      resultStatus,
    });
    await this.operationLogRepo.save(log);
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
