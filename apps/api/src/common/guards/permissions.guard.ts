import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Permission, roleHasPermission } from '@biz-reporting/shared-types';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

const TEMPORARY_PASSWORD_PERMISSIONS = new Set<Permission>([
  Permission.ME_READ,
  Permission.ME_PASSWORD_UPDATE,
  Permission.AUTH_LOGOUT,
]);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]) ?? [];
    const user = context.switchToHttp().getRequest().user as {
      role?: string;
      mustChangePassword?: boolean;
    } | undefined;
    if (user?.mustChangePassword && (
      required.length === 0 || required.some((permission) => !TEMPORARY_PASSWORD_PERMISSIONS.has(permission))
    )) {
      throw new ForbiddenException('请先修改临时密码');
    }
    if (required.length === 0) return true;
    if (!user?.role) throw new ForbiddenException('权限不足');
    if (!required.every((permission) => roleHasPermission(user.role!, permission))) {
      throw new ForbiddenException('权限不足');
    }
    return true;
  }
}
