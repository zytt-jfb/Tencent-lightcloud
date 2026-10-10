import { SetMetadata } from '@nestjs/common';
import { BizPermissionCodeValue } from '@biz-reporting/shared-types';

export const BIZ_PERMISSIONS_KEY = 'bizPermissions';

/**
 * biz 功能权限装饰器：路由需要满足全部指定权限码之一（任一如 super_admin 通配或拥有即放行）。
 * 用法：@BizPermissions(BizPermissionCode.OPERATION_CONTRACT_CREATE)
 */
export const BizPermissions = (...codes: BizPermissionCodeValue[]) =>
  SetMetadata(BIZ_PERMISSIONS_KEY, codes);
