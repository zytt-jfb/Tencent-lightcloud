import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { BizAuthGuard } from '../biz-auth/biz-auth.guard';
import { BizPermissionsGuard } from '../biz-auth/biz-permissions.guard';
import { BizPermissions } from '../biz-auth/biz-permissions.decorator';
import { BizAuthUser } from '../biz-auth/biz-auth-user.decorator';
import { BizAuthContext } from '../rbac/rbac.service';
import { BizPermissionCode } from '@biz-reporting/shared-types';
import { AnnouncementInput, BizCommunicationService } from './biz-communication.service';

@Controller('biz/announcements')
@Public()
@UseGuards(BizAuthGuard, BizPermissionsGuard)
export class BizAnnouncementController {
  constructor(private readonly service: BizCommunicationService) {}

  @Get('manage')
  @BizPermissions(BizPermissionCode.OPERATION_ANNOUNCEMENT_MANAGE, BizPermissionCode.OPERATION_ANNOUNCEMENT_CREATE)
  manageList(@BizAuthUser() auth: BizAuthContext) { return this.service.manageList(auth).then((items) => ({ items })); }

  @Post()
  @BizPermissions(BizPermissionCode.OPERATION_ANNOUNCEMENT_CREATE)
  create(@BizAuthUser() auth: BizAuthContext, @Body() dto: AnnouncementInput) { return this.service.create(auth, dto); }

  @Patch(':id')
  @BizPermissions(BizPermissionCode.OPERATION_ANNOUNCEMENT_CREATE)
  update(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string, @Body() dto: AnnouncementInput) { return this.service.update(auth, id, dto); }

  @Post(':id/publish')
  @BizPermissions(BizPermissionCode.OPERATION_ANNOUNCEMENT_PUBLISH)
  publish(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string) { return this.service.publish(auth, id); }

  @Post(':id/withdraw')
  @BizPermissions(BizPermissionCode.OPERATION_ANNOUNCEMENT_PUBLISH)
  withdraw(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string) { return this.service.withdraw(auth, id); }
}
