import { Controller, Get, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Permission, Role } from '@biz-reporting/shared-types';
import { Permissions } from '../common/decorators/permissions.decorator';
import type { DashboardStats, AdminBusinessSummaryResponse } from '@biz-reporting/shared-types';
import { DashboardService } from './dashboard.service';

@ApiTags('Admin - Dashboard')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SYSTEM_ADMIN)
@Controller('admin/dashboard')
@Permissions(Permission.DASHBOARD_READ)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  @ApiOperation({ summary: '获取仪表盘统计数据' })
  async getStats(
    @Query('year') year?: string,
    @Query('month') month?: string,
  ): Promise<DashboardStats> {
    const now = new Date();
    const y = year ? Number(year) : now.getFullYear();
    const m = month ? Number(month) : now.getMonth() + 1;
    return this.dashboardService.getStats(y, m);
  }

  @Get('business-summary')
  @ApiOperation({ summary: '获取经营汇总总览（按城市维度）' })
  @ApiQuery({ name: 'year', required: false, description: '年份，默认当前年份' })
  @Roles(Role.SYSTEM_ADMIN)
  async getBusinessSummary(
    @Query('year') year?: string,
  ): Promise<AdminBusinessSummaryResponse> {
    const now = new Date();
    const y = year ? Number(year) : now.getFullYear();

    if (year !== undefined) {
      const n = Number(year);
      if (!Number.isFinite(n) || isNaN(n)) {
        throw new BadRequestException('year 必须是合法数字');
      }
      if (n < 2000 || n > 2100) {
        throw new BadRequestException('year 必须在 2000-2100 之间');
      }
    }

    return this.dashboardService.getBusinessSummary(y);
  }
}
