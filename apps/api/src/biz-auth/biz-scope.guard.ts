import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RbacService, BizAuthContext } from '../rbac/rbac.service';
import { BIZ_SCOPE_KEY } from './biz-scope.decorator';

/**
 * biz 数据范围守卫：校验请求中携带的 provinceId/cityId 在认证账号数据范围内。
 * 基线：01 §3.3 / 02 §5 —— 任何客户端传入的地市/省份参数不得扩大认证账户的数据范围。
 * 地市用户强制使用绑定地市（传入其他地市 ID → 拒绝）。
 */
@Injectable()
export class BizScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rbac: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const enabled = this.reflector.getAllAndOverride<boolean>(BIZ_SCOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!enabled) return true;

    const request = context.switchToHttp().getRequest();
    const bizAuth = request.bizAuth as BizAuthContext | undefined;
    if (!bizAuth) throw new ForbiddenException('未认证');

    const body = request.body ?? {};
    const query = request.query ?? {};
    const provinceId = body.provinceId ?? query.provinceId ?? null;
    const cityId = body.cityId ?? query.cityId ?? null;

    await this.rbac.assertProvinceScope(bizAuth, provinceId);
    await this.rbac.assertCityScope(bizAuth, cityId);
    return true;
  }
}
