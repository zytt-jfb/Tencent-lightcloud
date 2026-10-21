import { BadRequestException, Body, Controller, Get, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { BizPermissionCode } from '@biz-reporting/shared-types';
import { Public } from '../common/decorators/public.decorator';
import { BizAuthGuard } from '../biz-auth/biz-auth.guard';
import { BizAuthUser } from '../biz-auth/biz-auth-user.decorator';
import { BizPermissions } from '../biz-auth/biz-permissions.decorator';
import { BizPermissionsGuard } from '../biz-auth/biz-permissions.guard';
import { BizAuthContext } from '../rbac/rbac.service';
import { PerformanceService } from './performance.service';

/**
 * 月度考核。
 * 权限点随迁移 045 引入：查看/导出授予 admin 与 city_user，
 * 上传（performance.upload.*）只给超管 —— 非超管因此看不到「绩效上传」菜单，
 * 也不会再出现「菜单点得开、接口 403」的错配。
 */
@Controller('biz/performance') @Public() @UseGuards(BizAuthGuard, BizPermissionsGuard)
export class PerformanceController {
  constructor(private readonly service: PerformanceService) {}
  @Get('monthly-score') @BizPermissions(BizPermissionCode.PERFORMANCE_OVERVIEW_READ) monthly(@Query() q: Record<string, string>, @BizAuthUser() auth: BizAuthContext) { return this.service.monthly(q, auth); }
  @Get('overview') @BizPermissions(BizPermissionCode.PERFORMANCE_OVERVIEW_READ) overview(@Query() q: Record<string, string>, @BizAuthUser() auth: BizAuthContext) { return this.service.overview(q, auth); }
  @Get('batches') @BizPermissions(BizPermissionCode.PERFORMANCE_UPLOAD_READ) batches(@BizAuthUser() auth: BizAuthContext) { return this.service.batches(auth); }
  @Post('upload') @BizPermissions(BizPermissionCode.PERFORMANCE_UPLOAD_CREATE) @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  upload(@UploadedFile() file: Express.Multer.File | undefined, @Body() body: Record<string, unknown>, @BizAuthUser() auth: BizAuthContext) { if (!file) throw new BadRequestException('请选择 Excel 文件'); return this.service.upload(file, auth, Number(body.assessmentYear)); }
  @Post('records') @BizPermissions(BizPermissionCode.PERFORMANCE_UPLOAD_CREATE) create(@Body() body: Record<string, unknown>, @BizAuthUser() auth: BizAuthContext) { return this.service.create(body, auth); }
}
