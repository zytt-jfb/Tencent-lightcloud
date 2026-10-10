import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { BizAuthGuard } from '../biz-auth/biz-auth.guard';
import { BizPermissionsGuard } from '../biz-auth/biz-permissions.guard';
import { BizPermissions } from '../biz-auth/biz-permissions.decorator';
import { BizAuthUser } from '../biz-auth/biz-auth-user.decorator';
import { BizAuthContext } from '../rbac/rbac.service';
import { BizPermissionCode } from '@biz-reporting/shared-types';
import { BizCommunicationService } from './biz-communication.service';

@Controller('biz/messages')
@Public()
@UseGuards(BizAuthGuard, BizPermissionsGuard)
export class BizMessageController {
  constructor(private readonly service: BizCommunicationService) {}

  @Get()
  @BizPermissions(BizPermissionCode.OPERATION_MESSAGE_READ)
  list(@BizAuthUser() auth: BizAuthContext) { return this.service.listInbox(auth); }

  @Post(':id/read')
  @BizPermissions(BizPermissionCode.OPERATION_MESSAGE_READ)
  markRead(@BizAuthUser() auth: BizAuthContext, @Param('id') id: string, @Body() body: { source?: 'announcement' | 'system' }) {
    return this.service.markRead(auth, id, body?.source === 'system' ? 'system' : 'announcement');
  }
}
