import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';

/**
 * JWT 认证守卫
 *
 * 继承 @nestjs/passport 的 AuthGuard('jwt')
 * 自动完成：提取 Bearer Token → 调用 JwtStrategy.validate() → 挂载 request.user
 *
 * @Public() 装饰器标记的路由会跳过认证
 *
 * 正确使用方式：在 AppModule providers 中用 APP_GUARD 注册，
 * 或者直接在 Controller 里用 @UseGuards(JwtAuthGuard)
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 检查 @Public() 装饰器
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    try {
      const result = await super.canActivate(context);
      return result as boolean;
    } catch {
      throw new UnauthorizedException('未登录或登录已过期');
    }
  }
}
