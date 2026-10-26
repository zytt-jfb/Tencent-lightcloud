import { Injectable, ExecutionContext, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PortalDomain, type PortalDomainValue } from '@biz-reporting/shared-types';

/**
 * biz 路由路径 → 门户域。
 *
 * 这里是「模块入口」这一层的唯一实现：老版本用一张 if/else 链把路径映射到
 * portal.enter / maintenance.operation.enter 等入口码，和前端的路由守卫、
 * 菜单过滤各写一遍，三处口径经常漂（表现为「菜单里能看到、点进去 403」）。
 * 现在只回答一个问题：这条路径属于哪个模块；「能不能进」由 RbacService 按
 * 权限码归属聚合出的 modulePermissions 判定，前后端同一份规则。
 *
 * 注意：这里只兜模块级门槛。具体动作（读/写/删）仍由 controller 上的
 * @BizPermissions 声明，两者是叠加关系，不是替代关系。
 */
function portalDomainOfPath(path: string): PortalDomainValue | null {
  if (path.startsWith('/api/biz/maintenance/') || path.startsWith('/api/biz/performance/')) {
    return PortalDomain.MAINTENANCE;
  }
  if (path.startsWith('/api/biz/assessment')) return PortalDomain.ENGINEERING;
  if (/^\/api\/biz\/(admin|settings)(\/|$)/.test(path)) return PortalDomain.SYSTEM;
  if (/^\/api\/biz\/(contracts|fee-rates|orders|completions|offline-completions|costs|aggregates|analysis|snapshots)(\/|$)/.test(path)) {
    return PortalDomain.OPERATION;
  }
  // 其余（auth/me、portal、ai、cities、workbench 等）不做模块级门槛
  return null;
}

/**
 * biz 认证守卫（AuthGuard('biz-jwt')）
 * 挂在 biz 控制器路由上（路由需同时标 @Public() 以跳过全局旧 JWT guard）。
 * 通过后 request.bizAuth 为 BizAuthContext（含权限码、模块域与数据范围）。
 */
@Injectable()
export class BizAuthGuard extends AuthGuard('biz-jwt') {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    try {
      const result = (await super.canActivate(context)) as boolean;
      // passport 将 validate() 返回值挂在 request.user；同步到 request.bizAuth 供装饰器/守卫使用
      const request = context.switchToHttp().getRequest();
      if (request.user) request.bizAuth = request.user;
      const path = String(request.originalUrl ?? request.url ?? '').split('?')[0];
      const domain = portalDomainOfPath(path);
      const ctx = request.bizAuth;
      if (domain && !ctx?.isSuperAdmin && !ctx?.modulePermissions?.has(domain)) {
        throw new ForbiddenException('没有访问该模块的权限');
      }
      return result;
    } catch (error) {
      if (error instanceof ForbiddenException) throw error;
      throw new UnauthorizedException('未登录或登录已过期');
    }
  }
}
