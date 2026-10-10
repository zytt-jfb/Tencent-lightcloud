import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@biz-reporting/shared-types';
import type { CityConfigDto } from '@biz-reporting/shared-types';
import type { Request as ExpressRequest } from 'express';
import { CityConfigsService } from './city-configs.service';

interface AuthenticatedRequest extends ExpressRequest {
  user: { userId: number; role: string };
}

@ApiTags('Admin - 城市配置')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SYSTEM_ADMIN)
@Controller('admin/city-configs')
export class CityConfigsController {
  constructor(private readonly service: CityConfigsService) {}

  @Get()
  @ApiOperation({ summary: '获取城市配置列表' })
  async list(): Promise<CityConfigDto[]> {
    return this.service.list();
  }

  @Patch(':cityId')
  @ApiOperation({ summary: '更新城市配置（enableMaintenance）' })
  async update(
    @Request() req: AuthenticatedRequest,
    @Param('cityId') cityId: number,
    @Body() body: { enableMaintenance: boolean },
  ): Promise<CityConfigDto> {
    return this.service.update(
      Number(cityId),
      body.enableMaintenance,
      req.user.userId,
    );
  }
}
