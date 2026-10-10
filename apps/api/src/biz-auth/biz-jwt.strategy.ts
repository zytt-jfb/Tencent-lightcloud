import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlatformUserEntity } from '../rbac/platform-user.entity';
import { RbacService, BizAuthContext } from '../rbac/rbac.service';
import { requireJwtAudience, requireJwtIssuer, requireJwtSecret } from '../auth/jwt.config';

/** biz JWT payload：kind='biz' 与旧体系 token（无 kind）区分 */
export interface BizJwtPayload {
  sub: string;
  kind: 'biz';
  authVersion: number;
}

/**
 * biz 用户 JWT 策略（'biz-jwt'）
 * 与旧 JwtStrategy 并存：biz token 带 kind='biz'，由本策略验证；
 * biz 路由标记 @Public() 跳过全局旧 guard，再用 AuthGuard('biz-jwt') 保护。
 */
@Injectable()
export class BizJwtStrategy extends PassportStrategy(Strategy, 'biz-jwt') {
  constructor(
    configService: ConfigService,
    @InjectRepository(PlatformUserEntity)
    private readonly userRepo: Repository<PlatformUserEntity>,
    private readonly rbac: RbacService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: requireJwtSecret(configService),
      issuer: requireJwtIssuer(configService),
      audience: requireJwtAudience(configService),
    });
  }

  async validate(payload: BizJwtPayload): Promise<BizAuthContext> {
    if (payload.kind !== 'biz' || typeof payload.sub !== 'string') {
      throw new UnauthorizedException('无效令牌');
    }
    const user = await this.userRepo.findOneBy({ id: payload.sub });
    if (!user) throw new UnauthorizedException('账号不存在或已被删除');
    if (user.status !== 'enabled') throw new UnauthorizedException('账号已被停用');
    if (!Number.isInteger(payload.authVersion) || payload.authVersion !== user.authVersion) {
      throw new UnauthorizedException('登录状态已失效');
    }
    // 加载角色默认权限 + 账号例外 + 数据范围
    return this.rbac.loadUserAuthContext(user.id);
  }
}
