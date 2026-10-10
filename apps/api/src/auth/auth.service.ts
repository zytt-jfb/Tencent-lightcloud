import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { UsersService } from '../users/users.service';
import { AccountSecurityService, SecurityActor } from '../users/account-security.service';
import {
  AdminLoginRequest,
  CityPasswordLoginRequest,
  LoginResponse,
  Role,
  UserStatus,
} from '@biz-reporting/shared-types';
import {
  LoginSecurityService,
  LoginRouteKey,
  LoginSecurityContext,
  LoginSecurityBlockedError,
} from './login-security.service';

/**
 * 预计算 dummy bcrypt hash（非任何真实密码）：
 * 用户不存在时也执行 bcrypt.compare，避免「账号是否存在」的时序侧信道。
 */
const DUMMY_PASSWORD_HASH = '$2a$10$5z8kiAlKpCdQasH2zEg4tuDz2lo/eGR6X2e4A.so51npXIU2SHAPe';

/**
 * Auth 核心服务
 *
 * 认证方式：
 * 1. admin-login: username + password_hash 对比 → JWT
 * 2. city-login: 地市用户账号密码 → JWT
 *
 * C-04/C-05 安全加固：
 * - LoginSecurityService：HMAC 哈希桶 + DB 事务 pessimistic_write + 第 5 次失败锁 15 分钟
 * - dummy bcrypt：账号不存在也执行 compare，统一 401 文案，不泄露账号存在性
 * - 审计只写 HMAC subject/ip 哈希，不写明文/密码/code/token
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly accountSecurity: AccountSecurityService,
    private readonly loginSecurity: LoginSecurityService,
  ) {}

  /**
   * 管理员密码登录（C-05：哈希桶限流 + dummy bcrypt + 统一 401）
   */
  async adminLogin(dto: AdminLoginRequest, context?: LoginSecurityContext): Promise<LoginResponse> {
    const route: LoginRouteKey = 'admin_login';
    const subject = dto.username;
    const ctx = this.withDefaultContext(context);

    await this.assertLoginAllowed(route, subject, ctx);

    const user = await this.usersService.findByUsername(subject);
    const passwordHash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const isPasswordValid = await bcrypt.compare(dto.password, passwordHash);

    const allowed =
      !!user &&
      [Role.ROOT_ADMIN, Role.CONTRACT_MANAGER, Role.SYSTEM_ADMIN].includes(user.role) &&
      !!user.passwordHash &&
      user.status === UserStatus.ENABLED &&
      isPasswordValid;

    if (!allowed) {
      await this.recordLoginFailure(route, subject, ctx, user?.id ?? null, user?.cityId ?? null);
      throw new UnauthorizedException('用户名或密码错误');
    }

    await this.recordLoginSuccess(route, subject, ctx, user.id, user.cityId);
    await this.usersService.updateLastLogin(user.id);
    return this.buildTokenResponse(user);
  }

  /**
   * 地市用户账号密码登录（C-05：同 admin 加固）
   */
  async cityLogin(dto: CityPasswordLoginRequest, context?: LoginSecurityContext): Promise<LoginResponse> {
    const route: LoginRouteKey = 'city_login';
    const subject = this.normalizeCityUsername(dto.username);
    const ctx = this.withDefaultContext(context);

    await this.assertLoginAllowed(route, subject, ctx);

    const user = await this.usersService.findByUsername(subject);
    const passwordHash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const isPasswordValid = await bcrypt.compare(dto.password, passwordHash);

    const allowed =
      !!user &&
      user.role === Role.CITY_USER &&
      !!user.passwordHash &&
      user.status === UserStatus.ENABLED &&
      !!user.cityId &&
      isPasswordValid;

    if (!allowed) {
      await this.recordLoginFailure(route, subject, ctx, user?.id ?? null, user?.cityId ?? null);
      throw new UnauthorizedException('用户名或密码错误');
    }

    await this.recordLoginSuccess(route, subject, ctx, user.id, user.cityId);
    await this.usersService.updateLastLogin(user.id);
    return this.buildTokenResponse(user);
  }

  /** 验证 JWT payload 中的用户是否仍然有效 */
  private normalizeCityUsername(value: string): string {
    if (typeof value !== 'string') {
      throw new BadRequestException('请输入人员姓名');
    }
    const username = value.trim();
    if (!username || username.length > 100) {
      throw new BadRequestException('人员姓名长度不合法');
    }
    return username;
  }

  async validateUser(userId: number) {
    return this.usersService.findById(userId);
  }

  /**
   * 构建统一登录响应
   */
  private buildTokenResponse(user: import('@biz-reporting/shared-types').User): LoginResponse {
    const payload = {
      sub: user.id,
      role: user.role,
      cityId: user.cityId,
      authVersion: user.authVersion,
    };

    // issuer/audience 由 JwtModule signOptions 统一注入（C-05）
    const token = this.jwtService.sign(payload);

    return {
      token,
      user: {
        id: user.id,
        role: user.role,
        name: user.name,
        cityId: user.cityId,
        mustChangePassword: Boolean(user.mustChangePassword),
      },
    };
  }

  async logout(actor: SecurityActor): Promise<{ success: true }> {
    await this.accountSecurity.auditLogout(actor);
    return { success: true };
  }

  // ---- C-04/C-05 安全辅助 ----

  private withDefaultContext(context?: LoginSecurityContext): LoginSecurityContext {
    // ip 必须非空（normalizeIp 拒绝空串）；requestId 缺失用空串（实体列非空）。
    return context ?? { ip: 'unknown', requestId: '' };
  }

  /** 登录前检查哈希桶是否锁定；锁定则记录 blocked 审计并映射为通用 401（不暴露细节）。 */
  private async assertLoginAllowed(route: LoginRouteKey, subject: string, ctx: LoginSecurityContext): Promise<void> {
    try {
      await this.loginSecurity.assertAllowed(route, subject);
    } catch (err) {
      if (err instanceof LoginSecurityBlockedError) {
        // blocked 审计写失败 → 503 传播（C-04 失败关闭）；锁定本身映射为通用 401 不暴露细节。
        await this.loginSecurity.recordBlocked({
          route,
          subject,
          context: ctx,
          outcome: 'blocked',
          reasonCode: 'ACCOUNT_RATE_BLOCKED',
        });
        throw new UnauthorizedException('尝试过于频繁，请稍后再试');
      }
      throw err;
    }
  }

  /** 登录失败：记录失败审计（HMAC，不写明文）。审计写失败 → 503 传播（C-04 失败关闭，不静默）。 */
  private async recordLoginFailure(
    route: LoginRouteKey,
    subject: string,
    ctx: LoginSecurityContext,
    userId: number | null,
    cityId: number | null,
  ): Promise<void> {
    await this.loginSecurity.recordFailure({
      route,
      subject,
      context: ctx,
      outcome: 'failed',
      reasonCode: 'INVALID_CREDENTIALS',
      userId,
      cityId,
    });
  }

  /** 登录成功：清桶并记录成功审计。审计写失败 → 503 传播（C-04 失败关闭）。 */
  private async recordLoginSuccess(
    route: LoginRouteKey,
    subject: string,
    ctx: LoginSecurityContext,
    userId: number,
    cityId: number | null,
  ): Promise<void> {
    await this.loginSecurity.recordSuccess({
      route,
      subject,
      context: ctx,
      outcome: 'success',
      reasonCode: 'OK',
      userId,
      cityId,
    });
  }
}
