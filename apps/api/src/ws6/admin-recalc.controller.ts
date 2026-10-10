import { Controller, Get, Post, Param, Body, UseGuards, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@biz-reporting/shared-types';
import { Ws6Service } from './ws6.service';
import { RetryRecalcTaskRequestDto } from './ws6.dto';

@ApiTags('Admin - Recalc')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SYSTEM_ADMIN)
@Controller('admin/recalc-tasks')
export class AdminRecalcController {
  constructor(private readonly ws6Service: Ws6Service) {}

  @Get()
  @ApiOperation({ summary: '获取重算任务列表' })
  async list() {
    return this.ws6Service.listRecalcTasks();
  }

  @Post(':taskId/retry')
  @ApiOperation({ summary: '重试重算任务' })
  async retry(@Param('taskId', ParseIntPipe) taskId: number, @Body() dto: RetryRecalcTaskRequestDto) {
    return this.ws6Service.retryRecalcTask(taskId, dto);
  }
}
