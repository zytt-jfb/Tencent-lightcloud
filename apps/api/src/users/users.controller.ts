import { Body, Controller, Get, Patch, UseGuards, Request } from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { UsersService } from './users.service';
import { ChangeOwnPasswordRequest, ChangeOwnPasswordResponse, MeResponse, Permission, UserStatus, Role } from '@biz-reporting/shared-types';
import { AccountSecurityService } from './account-security.service';
import { Permissions } from '../common/decorators/permissions.decorator';

/** 扩展 Express.Request，挂载 JWT 认证后的用户信息 */
interface AuthenticatedRequest extends ExpressRequest {
  user: {
    userId?: number;
    sub?: number;
    role?: string;
    name?: string;
    cityId?: number | null;
    status?: string;
    mustChangePassword?: boolean;
  };
}

@ApiTags('Me - 当前用户')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me')
export class UsersController {
  constructor(private readonly usersService: UsersService, private readonly accountSecurity: AccountSecurityService) {}

  @Get()
  @Permissions(Permission.ME_READ)
  @ApiOperation({ summary: '获取当前登录用户详情' })
  @ApiResponse({ status: 200, description: '成功' })
  async getMe(@Request() req: AuthenticatedRequest): Promise<MeResponse> {
    const userId = req.user?.userId || req.user?.sub || 0;
    const user = await this.usersService.findById(userId);
    if (!user) {
      // 用户未入库时返回 JWT 中的基本信息
      return {
        id: userId,
        role: (req.user?.role as Role) || ('unknown' as Role),
        name: req.user?.name || '',
        cityId: req.user?.cityId || null,
        cityName: null,
        status: UserStatus.ENABLED,
        mustChangePassword: Boolean(req.user?.mustChangePassword),
      };
    }
    return {
      id: user.id,
      role: user.role,
      name: user.name || '',
      cityId: user.cityId,
      cityName: user.cityName,  // ✅ 来自联表查询
      status: user.status,
      mustChangePassword: Boolean(user.mustChangePassword),
    };
  }

  @Patch('password')
  @Permissions(Permission.ME_PASSWORD_UPDATE)
  async changePassword(
    @Request() req: AuthenticatedRequest,
    @Body() dto: ChangeOwnPasswordRequest,
  ): Promise<ChangeOwnPasswordResponse> {
    await this.accountSecurity.changeOwnPassword({
      userId: req.user.userId || req.user.sub || 0,
      role: req.user.role || '',
      cityId: req.user.cityId ?? null,
    }, dto);
    return { success: true, requiresLogin: true };
  }
}
