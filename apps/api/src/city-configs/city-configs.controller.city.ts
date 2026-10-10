import { Controller, Get, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@biz-reporting/shared-types';
import type { Request as ExpressRequest } from 'express';
import { CityConfigsService } from './city-configs.service';

interface AuthenticatedRequest extends ExpressRequest {
  user: { userId: number; cityId: number; role: string };
}

@ApiTags('City - 城市配置')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CITY_USER)
@Controller('city/configs')
export class CityConfigsController {
  constructor(private readonly service: CityConfigsService) {}

  @Get()
  @ApiOperation({ summary: '获取当前城市配置（小程序端）' })
  async getMyConfig(@Request() req: AuthenticatedRequest) {
    const cityId = req.user.cityId;
    return this.service.getByCityId(Number(cityId));
  }
}
