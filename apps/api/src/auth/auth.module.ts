import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../users/user.entity';
import { AuthController } from './auth.controller';
import { AuthLoginRateLimitEntity } from './auth-login-rate-limit.entity';
import { AuthSecurityEventEntity } from './auth-security-event.entity';
import { AuthService } from './auth.service';
import { LoginSecurityService } from './login-security.service';
import { JwtStrategy } from './jwt.strategy';
import { UsersModule } from '../users/users.module';
import { requireJwtAudience, requireJwtIssuer, requireJwtSecret } from './jwt.config';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserEntity, AuthLoginRateLimitEntity, AuthSecurityEventEntity]),
    UsersModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: requireJwtSecret(config),
        signOptions: {
          expiresIn: config.get<string>('JWT_EXPIRES_IN') || '8h',
          // C-05：签发与 JwtStrategy 验证使用同一 issuer/audience（C-03 校验必填），
          // 否则 strategy 验证 issuer/audience 而签发不带会导致所有 token 验证失败。
          issuer: requireJwtIssuer(config),
          audience: requireJwtAudience(config),
        },
      }),
    }),
    HttpModule.register({
      timeout: 5000,
      maxRedirects: 0,
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, LoginSecurityService],
  exports: [AuthService, LoginSecurityService, JwtModule, PassportModule],
})
export class AuthModule {}
