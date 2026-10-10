import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * 标记路由为公开（跳过 JWT 认证）
 *
 * 用法: @Public()
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
