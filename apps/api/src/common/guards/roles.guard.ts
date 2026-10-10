import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role } from '@biz-reporting/shared-types';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

/**
 * 角色鉴权守卫
 *
 * 配合 @Roles(...) 使用，验证当前用户角色是否匹配
 * 使用方式: @UseGuards(JwtAuthGuard, RolesGuard) + @Roles(Role.SYSTEM_ADMIN)
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const explicitPermissions = this.reflector.getAllAndOverride(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (explicitPermissions) return true;

    const { user } = context.switchToHttp().getRequest();

    if (user.role !== Role.ROOT_ADMIN && !requiredRoles.includes(user.role)) {
      throw new ForbiddenException('权限不足');
    }

    return true;
  }
}
