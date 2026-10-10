import { Body, Controller, Get, Headers, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { BizAuthGuard } from './biz-auth.guard';
import { BizAuthService, BizChangeOwnPasswordRequest, BizLoginRequest } from './biz-auth.service';
import { BizAuthContext } from '../rbac/rbac.service';
import { BizAuthUser } from './biz-auth-user.decorator';

/**
 * biz 认证 API（新基线；与旧 auth API 并存）
 * POST /biz/auth/login   —— 用户名+密码登录（HMAC 桶限流 + 5 次失败锁 15 分钟）
 * GET  /biz/auth/me      —— 当前用户信息 + 权限码 + 数据范围
 */
@Controller('biz/auth')
export class BizAuthController {
  constructor(private readonly authService: BizAuthService) {}

  @Post('login')
  @Public()
  async login(
    @Body() dto: BizLoginRequest,
    @Req() req: Request,
    @Headers('x-request-id') requestId?: string,
  ) {
    const ip = (req.ip ?? req.socket?.remoteAddress ?? 'unknown') || 'unknown';
    return this.authService.login(dto, { ip, requestId: requestId ?? 'unknown' });
  }

  @Get('me')
  @Public()
  @UseGuards(BizAuthGuard)
  async me(@BizAuthUser() auth: BizAuthContext) {
    return this.authService.me(auth);
  }

  @Patch('me/password')
  @Public()
  @UseGuards(BizAuthGuard)
  async changeOwnPassword(
    @BizAuthUser() auth: BizAuthContext,
    @Body() dto: BizChangeOwnPasswordRequest,
  ) {
    await this.authService.changeOwnPassword(auth, dto);
    return { ok: true };
  }
}
