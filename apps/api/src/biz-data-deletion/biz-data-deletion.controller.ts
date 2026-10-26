import { Controller, Delete, ForbiddenException, Get, Param, UseGuards } from '@nestjs/common';
import { BizPermissionCode } from '@biz-reporting/shared-types';
import { Public } from '../common/decorators/public.decorator';
import { BizAuthGuard } from '../biz-auth/biz-auth.guard';
import { BizPermissionsGuard } from '../biz-auth/biz-permissions.guard';
import { BizPermissions } from '../biz-auth/biz-permissions.decorator';
import { BizAuthUser } from '../biz-auth/biz-auth-user.decorator';
import { BizAuthContext } from '../rbac/rbac.service';
import { BizDataDeletionService } from './biz-data-deletion.service';

/**
 * 超级管理员数据删除台账。
 *
 * 保护是三层叠加的（缺一层都不安全）：
 *   1. @BizPermissions 显式权限（system.data.read / system.data.delete）
 *   2. service 内部再校验 isSuperAdmin（双保险，防止将来误给普通角色发码）
 *   3. 操作写审计日志
 * 原先这里只靠 biz-auth.guard 的「路径前缀 → portal.system.enter」兜底，
 * 端点本身没有任何权限声明 —— 补上第 1 层后，删掉路径前缀映射才有意义。
 */
@Controller('biz/admin/data')
@Public()
@UseGuards(BizAuthGuard, BizPermissionsGuard)
export class BizDataDeletionController {
  constructor(private readonly service: BizDataDeletionService) {}

  @Get('resources')
  @BizPermissions(BizPermissionCode.SYSTEM_DATA_READ)
  resources(@BizAuthUser() auth: BizAuthContext) {
    this.assertSuperAdmin(auth);
    return { items: this.service.resources() };
  }

  @Get(':resource')
  @BizPermissions(BizPermissionCode.SYSTEM_DATA_READ)
  list(@BizAuthUser() auth: BizAuthContext, @Param('resource') resource: string) {
    return this.service.list(auth, resource).then((items) => ({ items }));
  }

  @Delete(':resource/:id')
  @BizPermissions(BizPermissionCode.SYSTEM_DATA_DELETE)
  remove(@BizAuthUser() auth: BizAuthContext, @Param('resource') resource: string, @Param('id') id: string) {
    return this.service.delete(auth, resource, id);
  }

  private assertSuperAdmin(auth: BizAuthContext): void {
    if (!auth.isSuperAdmin) throw new ForbiddenException('仅超级管理员可访问数据删除');
  }
}
