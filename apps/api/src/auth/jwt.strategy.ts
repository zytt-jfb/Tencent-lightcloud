import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from '../users/user.entity';
import { requireJwtAudience, requireJwtIssuer, requireJwtSecret } from './jwt.config';

/**
 * JWT 认证策略
 *
 * 从 Authorization: Bearer <token> 中提取并验证 JWT
 * payload 格式: { sub: userId, role: Role, cityId?: number, authVersion: number }
 * 签发与验证使用同一 issuer/audience（C-03 配置）；不增加旧密钥验证路径。
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: requireJwtSecret(configService),
      issuer: requireJwtIssuer(configService),
      audience: requireJwtAudience(configService),
    });
  }

  async validate(payload: { sub: number; role: string; cityId?: number; authVersion?: number }) {
    const user = await this.userRepository.findOne({
      where: { id: payload.sub },
    });

    if (!user) {
      throw new UnauthorizedException('用户不存在或已被删除');
    }

    if (user.status !== 'enabled') {
      throw new UnauthorizedException('账号已被禁用');
    }

    if (!Number.isInteger(payload.authVersion) || Number(payload.authVersion) !== Number(user.authVersion)) {
      throw new UnauthorizedException('登录状态已失效');
    }

    return {
      userId: user.id,
      role: user.role,
      cityId: user.cityId,
      authVersion: user.authVersion,
      mustChangePassword: Boolean(user.mustChangePassword),
    };
  }
}
