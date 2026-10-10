import { Controller, Delete, ForbiddenException, Get, Param, UseGuards } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { BizAuthGuard } from '../biz-auth/biz-auth.guard';
import { BizPermissionsGuard } from '../biz-auth/biz-permissions.guard';
import { BizAuthUser } from '../biz-auth/biz-auth-user.decorator';
import { BizAuthContext } from '../rbac/rbac.service';
import { BizDataDeletionService } from './biz-data-deletion.service';

@Controller('biz/admin/data')
@Public()
@UseGuards(BizAuthGuard, BizPermissionsGuard)
export class BizDataDeletionController {
  constructor(private readonly service: BizDataDeletionService) {}

  @Get('resources')
  resources(@BizAuthUser() auth: BizAuthContext) {
    this.assertSuperAdmin(auth);
    return { items: this.service.resources() };
  }

  @Get(':resource')
  list(@BizAuthUser() auth: BizAuthContext, @Param('resource') resource: string) {
    return this.service.list(auth, resource).then((items) => ({ items }));
  }

  @Delete(':resource/:id')
  remove(@BizAuthUser() auth: BizAuthContext, @Param('resource') resource: string, @Param('id') id: string) {
    return this.service.delete(auth, resource, id);
  }

  private assertSuperAdmin(auth: BizAuthContext): void {
    if (!auth.isSuperAdmin) throw new ForbiddenException('仅超级管理员可访问数据删除');
  }
}
