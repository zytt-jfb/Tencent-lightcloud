import {
  Controller,
  Get,
  Post,
  HttpCode,
  HttpStatus,
  Param,
  Body,
  Query,
  UseGuards,
  Request,
  BadRequestException,
} from '@nestjs/common';
import type { Request as ExpressRequest } from 'express';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@biz-reporting/shared-types';
import { PackagesService } from './packages.service';
import {
  DraftSaveRequest,
  SubmitMonthRequest,
} from '@biz-reporting/shared-types';

/** 扩展 Express.Request，挂载 JWT 认证后的用户信息 */
interface AuthenticatedRequest extends ExpressRequest {
  user: {
    userId: number;
    role: string;
    cityId: number | null;
  };
}

@ApiTags('City - 报表包（城市端）')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('city/packages')
export class PackagesController {
  constructor(private readonly packagesService: PackagesService) {}

  /**
   * 获取当前用户的当前年度报表包
   * 若不存在则自动创建（draft 状态）
   */
  @Get('current')
  @ApiOperation({ summary: '获取/创建当前年度报表包' })
  @Roles(Role.CITY_USER)
  async getCurrentPackage(
    @Request() req: AuthenticatedRequest,
    @Query('year') year: string,
  ) {
    const cityId = req.user.cityId ?? 0;
    if (!cityId) {
      throw new BadRequestException('当前账号未绑定城市，请联系管理员');
    }
    const pkg = await this.packagesService.getOrCreateCurrent(cityId, Number(year));
    // 聚合月度快照状态，供前端渲染 12 个月的状态网格
    const months = await this.packagesService.getMonthStatuses(pkg.id);
    // 城市有效合同分配数
    const contractCount = await this.packagesService.getCityContractCount(Number(cityId));
    // 年度累计汇总（仅基于已提交的 month_snapshots）
    const summary = await this.packagesService.getYearSummary(pkg.id);
    return { ...pkg, months, contractCount, summary };
  }

  /**
   * 获取某月份填报数据（草稿或最新快照）
   */
  @Get(':packageId/months/:monthNo')
  @ApiOperation({ summary: '获取指定月度填报数据' })
  @Roles(Role.CITY_USER, Role.SYSTEM_ADMIN)
  async getMonthData(
    @Param('packageId') packageId: number,
    @Param('monthNo') monthNo: number,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.packagesService.getMonthData(packageId, monthNo, req.user);
  }

  /**
   * 获取只读历史月数据（来自快照，不可编辑）
   */
  @Get(':packageId/read-only-months/:monthNo')
  @ApiOperation({ summary: '获取只读历史月数据（快照）' })
  @Roles(Role.CITY_USER, Role.SYSTEM_ADMIN)
  async getReadOnlyMonth(
    @Param('packageId') packageId: number,
    @Param('monthNo') monthNo: number,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.packagesService.getReadOnlySnapshot(packageId, monthNo, req.user);
  }

  /**
   * 草稿保存（随时可调用，upsert 语义）
   */
  @Post(':packageId/draft-save')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '草稿保存月度填报数据' })
  @ApiResponse({ status: 200, description: '保存成功' })
  @Roles(Role.CITY_USER)
  async draftSave(
    @Param('packageId') packageId: number,
    @Body() dto: DraftSaveRequest,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.packagesService.draftSave(packageId, dto, req.user);
  }

  /**
   * 提交预览（校验 + 汇总展示，不真正提交）
   */
  @Post(':packageId/submit-preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '提交预览（校验+汇总）' })
  @ApiResponse({ status: 200, description: '提交预览成功' })
  @Roles(Role.CITY_USER)
  async submitPreview(
    @Param('packageId') packageId: number,
    @Body() dto: SubmitMonthRequest,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.packagesService.submitPreview(packageId, dto, req.user);
  }

  /**
   * 正式提交月度数据 → 生成不可变快照
   */
  @Post(':packageId/submit')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '正式提交月度数据' })
  @ApiResponse({ status: 200, description: '提交成功，已生成快照' })
  @Roles(Role.CITY_USER)
  async submitMonth(
    @Param('packageId') packageId: number,
    @Body() dto: SubmitMonthRequest,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.packagesService.submitMonth(packageId, dto, req.user);
  }
}
