import { SetMetadata } from '@nestjs/common';
import { Role } from '@biz-reporting/shared-types';

export const ROLES_KEY = 'roles';

/**
 * 标记路由所需角色列表
 *
 * 用法: @Roles(Role.SYSTEM_ADMIN)
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
