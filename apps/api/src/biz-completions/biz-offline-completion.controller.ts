import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { BizAuthGuard } from '../biz-auth/biz-auth.guard';
import { BizPermissionsGuard } from '../biz-auth/biz-permissions.guard';
import { BizPermissions } from '../biz-auth/biz-permissions.decorator';
import { BizAuthUser } from '../biz-auth/biz-auth-user.decorator';
import { BizAuthContext } from '../rbac/rbac.service';
import { BizOfflineCompletionService, OfflineCompletionDto } from './biz-offline-completion.service';
import { BizPermissionCode } from '@biz-reporting/shared-types';

/**
 * 线下完工 API（新基线 M5）
 * 权限：read/create/submit（地市+省级）；approve/reject/void（super_admin/admin）。
 */
@Controller('biz/offline-completions')
@Public()
@UseGuards(BizAuthGuard, BizPermissionsGuard)
export class BizOfflineCompletionController {
  constructor(private readonly service: BizOfflineCompletionService) {}

  @Get()
  @BizPermissions(BizPermissionCode.OPERATION_COMPLETION_READ)
  async list(@BizAuthUser() auth: BizAuthContext, @Query('cityId') cityId?: string, @Query('status') status?: string) {
    return { items: await this.service.list(auth, { cityId, status }) };
  }

  @Get(':id')
  @BizPermissions(BizPermissionCode.OPERATION_COMPLETION_READ)
  async detail(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string) {
    return this.service.detail(auth, id);
  }

  @Post()
  @BizPermissions(BizPermissionCode.OPERATION_COMPLETION_CREATE)
  async create(@BizAuthUser() auth: BizAuthContext, @Body() dto: OfflineCompletionDto) {
    return this.service.create(auth, dto);
  }

  @Patch(':id')
  @BizPermissions(BizPermissionCode.OPERATION_COMPLETION_CREATE)
  async update(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string, @Body() dto: Partial<OfflineCompletionDto>) {
    return this.service.update(auth, id, dto);
  }

  @Post(':id/submit')
  @BizPermissions(BizPermissionCode.OPERATION_COMPLETION_SUBMIT)
  async submit(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string) {
    return this.service.submit(auth, id);
  }

  @Post(':id/withdraw')
  @BizPermissions(BizPermissionCode.OPERATION_COMPLETION_SUBMIT)
  async withdraw(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string) {
    return this.service.withdraw(auth, id);
  }

  @Post(':id/approve')
  @BizPermissions(BizPermissionCode.OPERATION_COMPLETION_APPROVE)
  async approve(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string) {
    return this.service.approve(auth, id);
  }

  @Post(':id/reject')
  @BizPermissions(BizPermissionCode.OPERATION_COMPLETION_REJECT)
  async reject(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string, @Body() body: { comment?: string }) {
    return this.service.reject(auth, id, body?.comment ?? '');
  }

  @Post(':id/void')
  @BizPermissions(BizPermissionCode.OPERATION_COMPLETION_VOID)
  async voidItem(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string, @Body() body: { reason?: string }) {
    return this.service.voidItem(auth, id, body?.reason ?? '');
  }

  @Post(':id/restore')
  @BizPermissions(BizPermissionCode.OPERATION_COMPLETION_VOID)
  async restoreItem(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string) {
    return this.service.restoreItem(auth, id);
  }
}
