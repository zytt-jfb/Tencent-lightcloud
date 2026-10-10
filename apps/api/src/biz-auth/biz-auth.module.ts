import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformUserEntity } from '../rbac/platform-user.entity';
import { RoleEntity } from '../rbac/role.entity';
import { ModuleEntity } from '../rbac/module.entity';
import { PermissionEntity } from '../rbac/permission.entity';
import { RolePermissionEntity } from '../rbac/role-permission.entity';
import { UserPermissionOverrideEntity } from '../rbac/user-permission-override.entity';
import { UserDataScopeEntity } from '../rbac/user-data-scope.entity';
import { UserRoleEntity } from '../rbac/user-role.entity';
import { UserScopeGrantEntity } from '../rbac/user-scope-grant.entity';
import { ProvinceEntity } from '../main-data/province.entity';
import { CityEntity } from '../main-data/city.entity';
import { BizOperationLogEntity } from '../operation-logs/biz-operation-log.entity';
import { RbacModule } from '../rbac/rbac.module';
import { AuthModule } from '../auth/auth.module';
import { requireJwtAudience, requireJwtIssuer, requireJwtSecret } from '../auth/jwt.config';
import { BizAuthService } from './biz-auth.service';
import { BizJwtStrategy } from './biz-jwt.strategy';
import { BizAuthGuard } from './biz-auth.guard';
import { BizPermissionsGuard } from './biz-permissions.guard';
import { BizScopeGuard } from './biz-scope.guard';
import { BizAdminService } from './biz-admin.service';
import { BizAuthController } from './biz-auth.controller';
import { BizPortalController } from './biz-portal.controller';
import { BizAdminController } from './biz-admin.controller';
import { BizCommonController } from '../biz-common.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PlatformUserEntity,
      RoleEntity,
      ModuleEntity,
      PermissionEntity,
      RolePermissionEntity,
      UserPermissionOverrideEntity,
      UserDataScopeEntity,
      UserRoleEntity,
      UserScopeGrantEntity,
      ProvinceEntity,
      CityEntity,
      BizOperationLogEntity,
    ]),
    RbacModule,
    AuthModule, // 复用 LoginSecurityService（HMAC 桶限流）
    PassportModule.register({ defaultStrategy: 'biz-jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: requireJwtSecret(config),
        signOptions: {
          expiresIn: config.get<string>('JWT_EXPIRES_IN') || '8h',
          issuer: requireJwtIssuer(config),
          audience: requireJwtAudience(config),
        },
      }),
    }),
  ],
  controllers: [BizAuthController, BizPortalController, BizAdminController, BizCommonController],
  providers: [
    BizAuthService,
    BizJwtStrategy,
    BizAuthGuard,
    BizPermissionsGuard,
    BizScopeGuard,
    BizAdminService,
  ],
  exports: [BizAuthService, BizAdminService, BizScopeGuard],
})
export class BizAuthModule {}
