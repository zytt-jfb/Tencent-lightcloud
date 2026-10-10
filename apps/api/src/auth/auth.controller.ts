import { Controller, Post, Body, HttpCode, HttpStatus, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import {
  AdminLoginRequest,
  CityPasswordLoginRequest,
} from './auth.dto';
import { Public } from '../common/decorators/public.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Permission } from '@biz-reporting/shared-types';
import type { SecurityActor } from '../users/account-security.service';
import type { LoginSecurityContext } from './login-security.service';

// Swagger @ApiResponse 需要 class（运行时值），不能用 interface
class LoginResponseDto {
  token: string;
  user: { id: number; role: string; name: string; cityId: number | null };
}

/** 控制器从可信代理后的请求中提取的安全上下文（C-03 TRUST_PROXY_HOPS 已配） */
interface AuthRequest {
  ip: string;
  requestId?: string;
}

/** 登录端点统一 5/min（覆盖全局默认 120/min，tasks.md C-05 步骤 2） */
const LOGIN_THROTTLE = { default: { limit: 5, ttl: 60_000 } };

@ApiTags('Auth - 认证')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('admin/login')
  @Public()
  @Throttle(LOGIN_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '管理员登录（用户名+密码）' })
  @ApiResponse({ status: 200, description: '登录成功', type: LoginResponseDto })
  @ApiResponse({ status: 401, description: '用户名或密码错误' })
  async adminLogin(
    @Body() dto: AdminLoginRequest,
    @Request() req: AuthRequest,
  ): Promise<LoginResponseDto> {
    return this.authService.adminLogin(dto, this.toSecurityContext(req));
  }

  @Post('city/login')
  @Public()
  @Throttle(LOGIN_THROTTLE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '地市用户账号密码登录' })
  @ApiResponse({ status: 200, description: '登录成功', type: LoginResponseDto })
  async cityLogin(
    @Body() dto: CityPasswordLoginRequest,
    @Request() req: AuthRequest,
  ): Promise<LoginResponseDto> {
    return this.authService.cityLogin(dto, this.toSecurityContext(req));
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @Permissions(Permission.AUTH_LOGOUT)
  async logout(@Request() req: { user: SecurityActor }): Promise<{ success: true }> {
    return this.authService.logout(req.user);
  }

  /** 提取可信请求上下文；requestId 由中间件注入（E-03 前回退生成 UUID）。ip 缺失回退 'unknown'（normalizeIp 拒绝空串）。 */
  private toSecurityContext(req: AuthRequest): LoginSecurityContext {
    return {
      ip: req.ip ?? 'unknown',
      requestId: req.requestId ?? 'req-' + Math.random().toString(36).slice(2, 12),
    };
  }
}
