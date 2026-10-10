import { BadRequestException, Body, Controller, Delete, Get, Header, Param, Patch, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Public } from '../common/decorators/public.decorator';
import { BizAuthGuard } from '../biz-auth/biz-auth.guard';
import { BizPermissionsGuard } from '../biz-auth/biz-permissions.guard';
import { BizScopeGuard } from '../biz-auth/biz-scope.guard';
import { BizPermissions } from '../biz-auth/biz-permissions.decorator';
import { BizScope } from '../biz-auth/biz-scope.decorator';
import { BizAuthUser } from '../biz-auth/biz-auth-user.decorator';
import { BizAuthContext } from '../rbac/rbac.service';
import {
  BizContractsService, CreateContractDto, UpdateContractDto, AllocationDto, FeeRateDto, BulkFeeRateDto, CopyFeeRateDto, MaintainImportRowDto, VoidContractDto,
} from './biz-contracts.service';
import { BizPermissionCode } from '@biz-reporting/shared-types';
import type { Response } from 'express';

/**
 * 合同域 API（新基线）
 * 基线：01 §4 / 02 TABLE 4 —— 权限矩阵（read/create/update/void/allocate/allocate_cancel/rate/export）
 * 数据范围：@BizScope 守卫校验省份/地市参数；city_user 仅已分配本地市合同。
 */
@Controller('biz/contracts')
@Public()
@UseGuards(BizAuthGuard, BizPermissionsGuard, BizScopeGuard)
export class BizContractsController {
  constructor(private readonly service: BizContractsService) {}

  @Get()
  @BizScope()
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_READ)
  async list(
    @BizAuthUser() auth: BizAuthContext,
    @Query('provinceId') provinceId?: string,
    @Query('cityId') cityId?: string,
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
    @Query('includeDeleted') includeDeleted?: string,
  ) {
    const items = await this.service.list(auth, { provinceId, cityId, status, keyword, includeDeleted: includeDeleted === 'true' || includeDeleted === '1' });
    return { items };
  }

  @Get('export')
  @BizScope()
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_EXPORT)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="contracts.csv"')
  async exportCsv(
    @BizAuthUser() auth: BizAuthContext,
    @Query('ids') ids?: string,
    @Query('includeDeleted') includeDeleted?: string,
    @Query('provinceId') provinceId?: string,
    @Query('cityId') cityId?: string,
    @Query('status') status?: string,
    @Query('keyword') keyword?: string,
  ) {
    const idList = ids ? ids.split(',').map((id) => id.trim()).filter(Boolean) : undefined;
    return this.service.exportCsv(auth, {
      ids: idList, includeDeleted: includeDeleted === 'true' || includeDeleted === '1', provinceId, cityId, status, keyword,
    });
  }

  @Get('overview')
  @BizScope()
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_READ)
  async overview(
    @BizAuthUser() auth: BizAuthContext,
    @Query('provinceId') provinceId?: string,
    @Query('cityId') cityId?: string,
    @Query('keyword') keyword?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('status') status?: string,
  ) {
    return { items: await this.service.overview(auth, { provinceId, cityId, keyword, startDate, endDate, status }) };
  }

  @Get('pending-maintenance')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_READ)
  async pendingMaintenance(@BizAuthUser() auth: BizAuthContext, @Query('keyword') keyword?: string) {
    return { items: await this.service.listPendingImportRows(auth, keyword) };
  }

  @Post('pending-maintenance/:sourceRowId')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_UPDATE)
  async maintainPendingRow(@BizAuthUser() auth: BizAuthContext, @Param('sourceRowId') sourceRowId: string, @Body() dto: MaintainImportRowDto) {
    return this.service.maintainImportRow(auth, sourceRowId, dto);
  }

  @Post()
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_CREATE)
  async create(@BizAuthUser() auth: BizAuthContext, @Body() dto: CreateContractDto) {
    return this.service.create(auth, dto);
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', {
    storage: memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
  }))
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_BATCH_CREATE)
  async upload(@BizAuthUser() auth: BizAuthContext, @UploadedFile() file: Express.Multer.File | undefined) {
    if (!file?.buffer) throw new BadRequestException('请选择合同 Excel 文件');
    return this.service.importWorkbookWithAllocations(auth, file.originalname ?? 'contracts.xlsx', file.buffer);
  }

  @Get('import-records')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_BATCH_READ)
  async importRecords(@BizAuthUser() auth: BizAuthContext) {
    return { items: await this.service.listImportRecords(auth) };
  }

  @Get('import-records/:id')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_BATCH_READ)
  async importRecordDetail(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string) {
    return this.service.importRecordDetail(auth, id);
  }

  @Get('import-records/:id/source-workbook')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_BATCH_READ)
  async importRecordWorkbook(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string, @Res() response: Response) {
    const file = await this.service.exportImportRecord(auth, id);
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    response.setHeader('Cache-Control', 'no-store');
    response.send(file.buffer);
  }

  @Delete('import-records/:id')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_BATCH_DELETE)
  async deleteImportRecord(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string) {
    await this.service.deleteImportRecord(auth, id);
    return { ok: true };
  }

  @Post('batch-clear-drafts')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_UPDATE)
  async batchClearDrafts(@BizAuthUser() auth: BizAuthContext, @Body() body: { ids?: string[] }) {
    return this.service.batchClearDrafts(auth, body?.ids ?? []);
  }

  @Get('batch-progress')
  @BizScope()
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_READ)
  async batchProgress(@BizAuthUser() auth: BizAuthContext, @Query('ids') ids?: string) {
    const idList = ids ? ids.split(',').map((id) => id.trim()).filter(Boolean) : [];
    return { progress: await this.service.batchProgress(auth, idList) };
  }

  @Get(':id')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_READ)
  async detail(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string) {
    return this.service.detail(auth, id);
  }

  @Patch(':id')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_UPDATE)
  async update(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string, @Body() dto: UpdateContractDto) {
    return this.service.update(auth, id, dto);
  }

  // ---- 状态机 ----
  @Post(':id/activate')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_UPDATE)
  async activate(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string) {
    return this.service.activate(auth, id);
  }

  @Post('batch-activate')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_UPDATE)
  async batchActivate(@BizAuthUser() auth: BizAuthContext, @Body() body: { ids?: string[]; dryRun?: boolean }) {
    return this.service.batchActivate(auth, body?.ids ?? [], Boolean(body?.dryRun));
  }

  @Post(':id/complete')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_UPDATE)
  async complete(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string) {
    return this.service.complete(auth, id);
  }

  @Post(':id/void')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_VOID)
  async voidContract(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string, @Body() dto: VoidContractDto) {
    return this.service.voidContract(auth, id, dto);
  }

  @Post(':id/restore')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_RESTORE)
  async restore(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string) {
    return this.service.restore(auth, id);
  }

  @Delete(':id')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_DELETE)
  async remove(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string) {
    return this.service.remove(auth, id);
  }

  @Post('batch-delete')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_BATCH_DELETE)
  async batchRemove(@BizAuthUser() auth: BizAuthContext, @Body() body: { ids?: string[] }) {
    return this.service.batchRemove(auth, body?.ids ?? []);
  }

  @Post('batch-update')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_BATCH_UPDATE)
  async batchUpdate(@BizAuthUser() auth: BizAuthContext, @Body() body: { ids?: string[]; dto?: UpdateContractDto }) {
    return this.service.batchUpdate(auth, body?.ids ?? [], body?.dto ?? {});
  }

  @Post('batch-restore')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_RESTORE)
  async batchRestore(@BizAuthUser() auth: BizAuthContext, @Body() body: { ids?: string[] }) {
    return this.service.batchRestore(auth, body?.ids ?? []);
  }

  @Post(':id/refresh-alerts')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_UPDATE)
  async refreshAlerts(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string) {
    await this.service.refreshAlerts(auth, id);
    return { ok: true };
  }

  // ---- 地市分配 ----
  @Post(':id/allocations')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_ALLOCATE)
  async upsertAllocation(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string, @Body() dto: AllocationDto) {
    return this.service.upsertAllocation(auth, id, dto);
  }

  @Delete(':id/allocations/:cityId')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_ALLOCATE_CANCEL)
  async cancelAllocation(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string, @Param('cityId') cityId: string) {
    await this.service.cancelAllocation(auth, id, cityId);
    return { ok: true };
  }

  // ---- 费率 ----
  @Get(':id/fee-rates')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_READ)
  async feeRates(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string) {
    const detail = await this.service.detail(auth, id);
    return { items: detail.feeRates };
  }

  @Post(':id/fee-rates')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_RATE)
  async addFeeRate(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string, @Body() dto: FeeRateDto) {
    return this.service.addFeeRate(auth, id, dto);
  }

  @Post(':id/fee-rates/batch')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_RATE)
  async batchFeeRates(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string, @Body() dto: BulkFeeRateDto) {
    return { items: await this.service.upsertFeeRates(auth, id, dto) };
  }

  @Post(':id/fee-rates/copy')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_RATE)
  async copyFeeRates(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string, @Body() dto: CopyFeeRateDto) {
    return { items: await this.service.copyFeeRates(auth, id, dto) };
  }

  @Get(':id/effective-rate')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_READ)
  async effectiveRate(
    @BizAuthUser() auth: BizAuthContext,
    @Param('id') id: string,
    @Query('cityId') cityId: string,
    @Query('month') month: string,
  ) {
    await this.service.detail(auth, id); // 可见性校验
    const rate = await this.service.getEffectiveRate(id, cityId, month);
    return { rate: rate ? { rateBp: rate.rateBp, effectiveMonth: rate.effectiveMonth } : null };
  }
}
