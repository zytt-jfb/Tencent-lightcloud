import { SetMetadata } from '@nestjs/common';

export const BIZ_SCOPE_KEY = 'bizScope';

/**
 * biz 数据范围守卫标记：校验请求 body/query 中的 provinceId/cityId 在认证账号数据范围内。
 * 用法：@BizScope()
 */
export const BizScope = () => SetMetadata(BIZ_SCOPE_KEY, true);
