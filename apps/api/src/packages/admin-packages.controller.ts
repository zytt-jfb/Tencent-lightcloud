import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import type { Request as ExpressRequest } from 'express';
import { Role } from '@biz-reporting/shared-types';
import type {
  AdminPackageItem,
  PaginatedResponse,
  ReturnToDraftRequest,
  UnlockMonthsRequest,
  BulkUnlockMonthsRequest,
  BulkUnlockMonthsResponse,
  OpenCurrentMonthContractRequest,
} from '@biz-reporting/shared-types';
import { PackagesService } from './packages.service';

interface AuthenticatedRequest extends ExpressRequest {
  user: { userId: number; role: string; cityId: number | null };
}

@ApiTags('Admin - 报表包管理')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SYSTEM_ADMIN)
@Controller('admin/packages')
export class AdminPackagesController {
  constructor(private readonly packagesService: PackagesService) {}

  @Get()
  @ApiOperation({ summary: '获取所有报表包列表（含月度上下文）' })
  async listAll(): Promise<PaginatedResponse<AdminPackageItem>> {
    return this.packagesService.listAllPackages();
  }

  @Post('bulk-unlock-months')
  @ApiOperation({ summary: '批量解锁指定年度全部地市的指定月份' })
  @ApiResponse({ status: 200, description: '批量解锁成功' })
  async bulkUnlockMonths(
    @Request() req: AuthenticatedRequest,
    @Body() dto: BulkUnlockMonthsRequest,
  ): Promise<BulkUnlockMonthsResponse> {
    return this.packagesService.bulkUnlockMonths(dto, req.user);
  }
  @Post(':packageId/return-to-draft')
  @ApiOperation({ summary: '退回已提交的报表包到草稿状态' })
  @ApiResponse({ status: 200, description: '退回成功' })
  async returnToDraft(
    @Request() req: AuthenticatedRequest,
    @Param('packageId') packageId: number,
    @Body() dto: ReturnToDraftRequest,
  ): Promise<{ success: boolean; message: string }> {
    return this.packagesService.returnToDraft(packageId, dto, req.user);
  }

  @Post(':packageId/unlock-months')
  @ApiOperation({ summary: '解锁历史月份（开放编辑权限）' })
  @ApiResponse({ status: 200, description: '解锁成功' })
  async unlockMonths(
    @Request() req: AuthenticatedRequest,
    @Param('packageId') packageId: number,
    @Body() dto: UnlockMonthsRequest,
  ): Promise<{ success: boolean; message: string; unlockedMonths: number[] }> {
    return this.packagesService.unlockMonths(packageId, dto, req.user);
  }

  @Post(':packageId/open-current-month-contract')
  @ApiOperation({ summary: '开放当月新增合同填报权限（仅当前月）' })
  @ApiResponse({ status: 200, description: '开放成功' })
  @ApiResponse({ status: 400, description: '非当前月或合同未分配给该地市' })
  async openCurrentMonthContract(
    @Request() req: AuthenticatedRequest,
    @Param('packageId') packageId: number,
    @Body() dto: OpenCurrentMonthContractRequest,
  ): Promise<{ success: boolean; message: string }> {
    return this.packagesService.openCurrentMonthContract(packageId, dto, req.user);
  }
}
