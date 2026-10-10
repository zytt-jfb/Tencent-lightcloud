import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  Request,
  UseGuards,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Permission, Role } from '@biz-reporting/shared-types';
import { Permissions } from '../common/decorators/permissions.decorator';
import { ContractsService } from './contracts.service';
import type { Express } from 'express';
import type {
  CreateContractRequest,
  CreateAllocationRequest,
  UpdateContractRequest,
  PaginationParams,
} from '@biz-reporting/shared-types';

/** 认证请求上下文（JWT 中间件注入） */
interface AuthenticatedRequest extends Express.Request {
  user: {
    userId: number;
    role: string;
    cityId: number | null;
  };
}

@ApiTags('Admin - 合同管理')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SYSTEM_ADMIN)
@Controller('admin/contracts')
@Permissions(Permission.CONTRACTS_READ)
export class ContractsController {
  constructor(private readonly contractsService: ContractsService) {}

  /**
   * 分页查询合同列表（排除软删除）
   */
  @Get()
  @ApiOperation({ summary: '分页获取合同列表' })
  async list(
    @Query() params: PaginationParams,
  ): Promise<Awaited<ReturnType<ContractsService['list']>>> {
    return this.contractsService.list(params);
  }

  /**
   * 获取合同详情
   */
  @Get(':contractId')
  @ApiOperation({ summary: '获取合同详情' })
  async getOne(@Param('contractId') id: number) {
    return this.contractsService.findOne(id);
  }

  /**
   * 创建新合同
   */
  @Post()
  @Permissions(Permission.CONTRACTS_CREATE)
  @ApiOperation({ summary: '创建合同' })
  @ApiResponse({ status: 201, description: '创建成功' })
  async create(
    @Body() dto: CreateContractRequest,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.contractsService.create(dto, req.user.userId);
  }

  /**
   * 更新合同信息（OpenAPI 规定用 PATCH）
   */
  @Patch(':contractId')
  @Permissions(Permission.CONTRACTS_UPDATE)
  @ApiOperation({ summary: '更新合同' })
  async update(
    @Param('contractId') id: number,
    @Body() dto: UpdateContractRequest,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.contractsService.update(id, dto, req.user.userId);
  }

  /**
   * 软删除合同（标记 is_deleted=1）
   */
  @Delete(':contractId')
  @Permissions(Permission.CONTRACTS_SOFT_DELETE)
  @ApiOperation({ summary: '软删除合同' })
  @ApiResponse({ status: 200, description: '已软删除，快照数据不受影响' })
  async softDelete(
    @Param('contractId') id: number,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.contractsService.softDelete(id, req.user.userId);
  }

  @Delete('all/purge')
  @Permissions(Permission.CONTRACTS_PURGE)
  @ApiOperation({ summary: '[危险] 物理清除所有合同及相关分配数据' })
  async purgeAll() {
    throw new ForbiddenException('Physical deletion endpoint is disabled');
    try {
      return await this.contractsService.purgeAll();
    } catch (err: unknown) {
      const errorObj: { message?: unknown } = (err && typeof err === 'object' && err !== null) ? err as { message?: unknown } : {};
      const raw = errorObj.message;
      const errorMessage = typeof raw === 'string' ? raw : null;
      throw new BadRequestException(errorMessage || '清除失败');
    }
  }

  // ============================================================
  // 合同跨地市分配（嵌套路由，符合 OpenAPI 规范）
  // ============================================================

  /**
   * 为合同添加城市分配（OpenAPI: POST /admin/contracts/{contractId}/allocations）
   */
  @Post(':contractId/allocations')
  @Permissions(Permission.CONTRACT_ALLOCATIONS_CREATE)
  @ApiOperation({ summary: '新增城市分配' })
  @ApiResponse({ status: 201, description: '创建成功' })
  async createAllocation(
    @Param('contractId') contractId: number,
    @Body() dto: CreateAllocationRequest,
  ) {
    // 确保 contractId 一致性
    dto.contractId = Number(contractId);
    return this.contractsService.createAllocation(dto);
  }
}
