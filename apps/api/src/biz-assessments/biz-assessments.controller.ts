import {
  BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { BizPermissionCode } from '@biz-reporting/shared-types';
import { Public } from '../common/decorators/public.decorator';
import { BizAuthGuard } from '../biz-auth/biz-auth.guard';
import { BizPermissionsGuard } from '../biz-auth/biz-permissions.guard';
import { BizPermissions } from '../biz-auth/biz-permissions.decorator';
import { BizAuthUser } from '../biz-auth/biz-auth-user.decorator';
import { BizAuthContext } from '../rbac/rbac.service';
import {
  ASSESSMENT_FILE_MAX_BYTES, BizAssessmentsImportService,
} from './biz-assessments-import.service';
import { AssessmentQueryFilter, BizAssessmentsQueryService } from './biz-assessments-query.service';
import { AssessmentEntryDto, BizAssessmentsEntryService } from './biz-assessments-entry.service';
import { BizAssessmentsScorecardService } from './biz-assessments-scorecard.service';

/** 查询参数可能是单值或数组，统一成数组 */
function toArray(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function toFilter(query: Record<string, unknown>): AssessmentQueryFilter {
  return {
    months: toArray(query.months),
    year: query.year ? String(query.year) : undefined,
    cityIds: toArray(query.cityIds),
    supplierName: query.supplierName ? String(query.supplierName) : undefined,
    projectName: query.projectName ? String(query.projectName) : undefined,
    evalMethod: query.evalMethod ? String(query.evalMethod) : undefined,
    source: query.source ? String(query.source) : undefined,
    status: query.status ? String(query.status) : undefined,
    page: query.page ? Number(query.page) : undefined,
    pageSize: query.pageSize ? Number(query.pageSize) : undefined,
  };
}

/**
 * 后评估 API（工程管理 / 后评估管理）
 * 三块能力：
 *  - 概览：多维筛选 + 指标聚合 + 导出（前端 exportPageRows 出 xlsx）
 *  - 数据导入：解析预览（不落库）→ 确认导入（按业务键 upsert）→ 批次管理
 *  - 线下填报：合同 × 月份 × 供应商，draft → submitted，省管理员可退回/作废
 * 入口鉴权由 BizAuthGuard 统一映射到 portal.engineering.enter（见 biz-auth.guard.ts）。
 */
@Controller('biz/assessment')
@Public()
@UseGuards(BizAuthGuard, BizPermissionsGuard)
export class BizAssessmentsController {
  constructor(
    private readonly importService: BizAssessmentsImportService,
    private readonly queryService: BizAssessmentsQueryService,
    private readonly entryService: BizAssessmentsEntryService,
    private readonly scorecardService: BizAssessmentsScorecardService,
  ) {}

  // ==================== 概览 ====================

  @Get('overview')
  @BizPermissions(BizPermissionCode.ASSESSMENT_OVERVIEW_READ)
  async overview(@BizAuthUser() auth: BizAuthContext, @Query() query: Record<string, unknown>) {
    return this.queryService.list(auth, toFilter(query));
  }

  @Get('overview/summary')
  @BizPermissions(BizPermissionCode.ASSESSMENT_OVERVIEW_READ)
  async summary(@BizAuthUser() auth: BizAuthContext, @Query() query: Record<string, unknown>) {
    return this.queryService.summary(auth, toFilter(query));
  }

  @Get('overview/options')
  @BizPermissions(BizPermissionCode.ASSESSMENT_OVERVIEW_READ)
  async options(@BizAuthUser() auth: BizAuthContext) {
    return this.queryService.options(auth);
  }

  /** 导出数据源：不翻页，最多 20000 行，由前端统一走 exportPageRows 生成 xlsx */
  @Get('overview/export')
  @BizPermissions(BizPermissionCode.ASSESSMENT_OVERVIEW_EXPORT)
  async exportRows(@BizAuthUser() auth: BizAuthContext, @Query() query: Record<string, unknown>) {
    const items = await this.queryService.listAll(auth, toFilter(query));
    return { items, total: items.length };
  }

  /** 供应商明细：选中供应商 × 月份 → 每个采购项目的本月得分、累计、两个排名 */
  @Get('scorecard')
  @BizPermissions(BizPermissionCode.ASSESSMENT_OVERVIEW_READ)
  async scorecard(@BizAuthUser() auth: BizAuthContext, @Query() query: Record<string, unknown>) {
    return this.scorecardService.scorecard(auth, {
      supplier: String(query.supplier ?? ''),
      month: query.month ? String(query.month) : undefined,
      projectNames: toArray(query.projects),
      provinceIds: toArray(query.provinceIds),
    });
  }

  /** 单合同排名解剖：块① 地市维度、块② 省维度排名、块③ 供应商分层、月度趋势 */
  @Get('project-breakdown')
  @BizPermissions(BizPermissionCode.ASSESSMENT_OVERVIEW_READ)
  async projectBreakdown(@BizAuthUser() auth: BizAuthContext, @Query() query: Record<string, unknown>) {
    return this.scorecardService.breakdown(auth, {
      projectName: String(query.project ?? ''),
      month: query.month ? String(query.month) : undefined,
      supplier: String(query.supplier ?? ''),
    });
  }

  // ==================== 数据导入 ====================

  @Get('batches')
  @BizPermissions(BizPermissionCode.ASSESSMENT_IMPORT_READ)
  async batches() {
    const items = await this.importService.listBatches();
    return { items };
  }

  @Post('import/preview')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: ASSESSMENT_FILE_MAX_BYTES } }))
  @BizPermissions(BizPermissionCode.ASSESSMENT_IMPORT_UPLOAD)
  async preview(@UploadedFile() file?: Express.Multer.File, @Body() body?: { sheetName?: string }) {
    if (!file) throw new BadRequestException('请选择要上传的 Excel 文件');
    return this.importService.preview(file, body?.sheetName);
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: ASSESSMENT_FILE_MAX_BYTES } }))
  @BizPermissions(BizPermissionCode.ASSESSMENT_IMPORT_UPLOAD)
  async commit(@BizAuthUser() auth: BizAuthContext, @UploadedFile() file?: Express.Multer.File, @Body() body?: { sheetName?: string }) {
    if (!file) throw new BadRequestException('请选择要上传的 Excel 文件');
    return this.importService.commit(auth, file, body?.sheetName);
  }

  @Delete('batches/:id')
  @BizPermissions(BizPermissionCode.ASSESSMENT_IMPORT_DELETE)
  async deleteBatch(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string) {
    return this.importService.deleteBatch(auth, id);
  }

  // ==================== 线下填报 ====================

  @Get('entries')
  @BizPermissions(BizPermissionCode.ASSESSMENT_ENTRY_READ)
  async entries(@BizAuthUser() auth: BizAuthContext, @Query() query: Record<string, unknown>) {
    const items = await this.entryService.list(auth, {
      months: toArray(query.months),
      status: query.status ? String(query.status) : undefined,
      cityIds: toArray(query.cityIds),
      supplierName: query.supplierName ? String(query.supplierName) : undefined,
      contractNo: query.contractNo ? String(query.contractNo) : undefined,
    });
    return { items };
  }

  @Get('entries/contract-options')
  @BizPermissions(BizPermissionCode.ASSESSMENT_ENTRY_READ)
  async contractOptions(@BizAuthUser() auth: BizAuthContext, @Query('keyword') keyword?: string) {
    return { items: await this.entryService.contractOptions(auth, keyword) };
  }

  @Get('entries/city-options')
  @BizPermissions(BizPermissionCode.ASSESSMENT_ENTRY_READ)
  async cityOptions(@BizAuthUser() auth: BizAuthContext, @Query('contractId') contractId?: string) {
    return { items: await this.entryService.cityOptions(auth, String(contractId ?? '')) };
  }

  @Post('entries')
  @BizPermissions(BizPermissionCode.ASSESSMENT_ENTRY_CREATE)
  async createEntry(@BizAuthUser() auth: BizAuthContext, @Body() dto: AssessmentEntryDto) {
    return this.entryService.create(auth, dto);
  }

  @Patch('entries/:id')
  @BizPermissions(BizPermissionCode.ASSESSMENT_ENTRY_CREATE)
  async updateEntry(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string, @Body() dto: Partial<AssessmentEntryDto>) {
    return this.entryService.update(auth, id, dto);
  }

  @Post('entries/:id/submit')
  @BizPermissions(BizPermissionCode.ASSESSMENT_ENTRY_SUBMIT)
  async submitEntry(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string) {
    return this.entryService.submit(auth, id);
  }

  @Post('entries/:id/withdraw')
  @BizPermissions(BizPermissionCode.ASSESSMENT_ENTRY_SUBMIT)
  async withdrawEntry(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string) {
    return this.entryService.withdraw(auth, id);
  }

  @Post('entries/:id/return')
  @BizPermissions(BizPermissionCode.ASSESSMENT_ENTRY_RETURN)
  async returnEntry(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string, @Body() body: { reason?: string }) {
    return this.entryService.returnEntry(auth, id, body?.reason ?? '');
  }

  @Post('entries/:id/void')
  @BizPermissions(BizPermissionCode.ASSESSMENT_ENTRY_RETURN)
  async voidEntry(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string, @Body() body: { reason?: string }) {
    return this.entryService.voidEntry(auth, id, body?.reason ?? '');
  }

  @Delete('entries/:id')
  @BizPermissions(BizPermissionCode.ASSESSMENT_ENTRY_CREATE)
  async removeEntry(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string) {
    return this.entryService.remove(auth, id);
  }
}
