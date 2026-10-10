import {
  Controller,
  Patch,
  Delete,
  Param,
  Body,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Permission, Role } from '@biz-reporting/shared-types';
import { Permissions } from '../common/decorators/permissions.decorator';
import { ContractsService } from './contracts.service';
import type { UpdateAllocationRequest } from '@biz-reporting/shared-types';

/**
 * 分配管理控制器
 *
 * 路由严格匹配 OpenAPI:
 * - PATCH /api/admin/allocations/{allocationId}
 * - DELETE /api/admin/allocations/{allocationId}
 */
@ApiTags('Admin - 合同分配管理')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SYSTEM_ADMIN)
@Controller('admin/allocations')
export class AllocationsController {
  constructor(private readonly contractsService: ContractsService) {}

  /**
   * 更新分配信息（OpenAPI: PATCH /admin/allocations/{allocationId}）
   */
  @Patch(':allocationId')
  @Permissions(Permission.CONTRACT_ALLOCATIONS_UPDATE)
  @ApiOperation({ summary: '更新城市分配' })
  async update(
    @Param('allocationId') id: number,
    @Body() dto: UpdateAllocationRequest,
  ) {
    return this.contractsService.updateAllocation(id, dto);
  }

  /**
   * 删除分配（OpenAPI: DELETE /admin/allocations/{allocationId}）
   */
  @Delete(':allocationId')
  @Permissions(Permission.CONTRACT_ALLOCATIONS_DELETE)
  @ApiOperation({ summary: '删除城市分配' })
  async deleteAllocation(@Param('allocationId') id: number) {
    return this.contractsService.deleteAllocation(id);
  }
}
