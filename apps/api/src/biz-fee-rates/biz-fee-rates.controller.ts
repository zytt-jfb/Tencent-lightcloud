import { BadRequestException, Body, Controller, Get, Param, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Public } from '../common/decorators/public.decorator';
import { BizAuthGuard } from '../biz-auth/biz-auth.guard';
import { BizPermissionsGuard } from '../biz-auth/biz-permissions.guard';
import { BizPermissions } from '../biz-auth/biz-permissions.decorator';
import { BizAuthUser } from '../biz-auth/biz-auth-user.decorator';
import { BizAuthContext } from '../rbac/rbac.service';
import { BizPermissionCode } from '@biz-reporting/shared-types';
import { BizFeeRatesService, BulkApplyDto, CopyFeeRatesDto } from './biz-fee-rates.service';
import type { Response } from 'express';

/**
 * 管理费率批量维护 API
 * 权限口径：费率属于合同管理能力，全部复用合同域权限码（角色级，contract_manager 默认具备）：
 *  - 查询/预览：operation.contract.read
 *  - 导出：operation.contract.export
 *  - 写入（确认导入 / 复制 / 批量套用）：operation.contract.rate
 * 不使用 @BizScope 守卫：该守卫对 scopeType='contract'（合同管理员）直接拒绝，
 * 会导致合同管理员不可用；数据范围改为服务层按角色自行收敛。
 */
@Controller('biz/fee-rates')
@Public()
@UseGuards(BizAuthGuard, BizPermissionsGuard)
export class BizFeeRatesController {
  constructor(private readonly service: BizFeeRatesService) {}

  /** 待维护清单（只列有订单的组合；支持关键词/省份/地市/月份范围/状态/仅缺失/分页） */
  @Get('maintenance')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_READ)
  async maintenance(
    @BizAuthUser() auth: BizAuthContext,
    @Query('keyword') keyword?: string,
    @Query('provinceId') provinceId?: string,
    @Query('cityId') cityId?: string,
    @Query('monthFrom') monthFrom?: string,
    @Query('monthTo') monthTo?: string,
    @Query('status') status?: string,
    @Query('onlyMissing') onlyMissing?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const result = await this.service.listMaintenance(auth, {
      keyword, provinceId, cityId, monthFrom, monthTo, status,
      onlyMissing: onlyMissing === 'true' || onlyMissing === '1',
      page: Number(page ?? 1), pageSize: Number(pageSize ?? 20),
    });
    return { items: result.items, total: result.total };
  }

  /** 导出待维护清单（xlsx，含经营单位ID，供管理员线下填写后导入） */
  @Get('maintenance/export')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_EXPORT)
  async maintenanceExport(
    @BizAuthUser() auth: BizAuthContext,
    @Res() response: Response,
    @Query('keyword') keyword?: string,
    @Query('provinceId') provinceId?: string,
    @Query('cityId') cityId?: string,
    @Query('monthFrom') monthFrom?: string,
    @Query('monthTo') monthTo?: string,
    @Query('status') status?: string,
    @Query('onlyMissing') onlyMissing?: string,
  ) {
    const file = await this.service.exportMaintenance(auth, {
      keyword, provinceId, cityId, monthFrom, monthTo, status,
      onlyMissing: onlyMissing === 'true' || onlyMissing === '1',
    });
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    response.setHeader('Cache-Control', 'no-store');
    response.send(file.buffer);
  }

  /** 导入第一步：上传并解析（不写库），返回预览统计与明细 */
  @Post('import/preview')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_READ)
  async importPreview(
    @BizAuthUser() auth: BizAuthContext,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    if (!file?.buffer) throw new BadRequestException('请选择费率 Excel 文件');
    // 无条件覆盖：上传命中「合同+经营单位+生效月份」已有费率时一律按覆盖处理，无需 allowOverwrite 开关
    return this.service.previewImport(auth, file.originalname ?? 'fee-rates.xlsx', file.buffer);
  }

  /** 导入第二步：用户确认后才事务写入并触发订单重算 */
  @Post('import/confirm')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_RATE)
  async importConfirm(@BizAuthUser() auth: BizAuthContext, @Body() body: { taskId?: string }) {
    if (!body?.taskId) throw new BadRequestException('缺少导入任务 ID');
    return this.service.confirmImport(auth, body.taskId);
  }

  /** 任务状态查询（排队中 / 处理中 / 已完成 / 部分失败 / 失败） */
  @Get('import/:taskId')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_READ)
  async importTask(@BizAuthUser() auth: BizAuthContext, @Param('taskId') taskId: string) {
    return this.service.getTask(auth, taskId);
  }

  /** 失败/跳过明细 */
  @Get('import/:taskId/errors')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_READ)
  async importTaskErrors(@BizAuthUser() auth: BizAuthContext, @Param('taskId') taskId: string) {
    return this.service.getTaskErrors(auth, taskId);
  }

  /** 复制历史月份：跨合同跨地市，默认不覆盖目标月份已有记录 */
  @Post('copy')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_RATE)
  async copy(@BizAuthUser() auth: BizAuthContext, @Body() dto: CopyFeeRatesDto) {
    return this.service.copyFeeRates(auth, dto);
  }

  /** 批量套用统一费率：必须显式指定合同、地市、生效月份与费率 */
  @Post('bulk-apply')
  @BizPermissions(BizPermissionCode.OPERATION_CONTRACT_RATE)
  async bulkApply(@BizAuthUser() auth: BizAuthContext, @Body() dto: BulkApplyDto) {
    return this.service.bulkApply(auth, dto);
  }
}
