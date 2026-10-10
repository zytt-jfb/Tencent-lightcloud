import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BizAuthContext } from '../rbac/rbac.service';
import { BIZ_PERMISSIONS_KEY } from './biz-permissions.decorator';
import { BizPermissionCodeValue } from '@biz-reporting/shared-types';

/**
 * biz 功能权限守卫：校验 request.bizAuth 是否拥有 @BizPermissions 声明的全部权限码。
 * super_admin 由 RbacService.assertPermission 通配。
 */
@Injectable()
export class BizPermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<BizPermissionCodeValue[]>(BIZ_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? [];
    if (required.length === 0) return true;
    const ctx = context.switchToHttp().getRequest().bizAuth as BizAuthContext | undefined;
    if (!ctx) throw new ForbiddenException('未认证');
    for (const code of required) {
      if (ctx.isSuperAdmin || ctx.permissionCodes.has(code)) return true;
    }
    throw new ForbiddenException('权限不足');
  }
}
