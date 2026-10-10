import { Body, Controller, Delete, Get, Param, Patch, Post, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Permission, Role } from '@biz-reporting/shared-types';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { AdminCitiesService, CreateCityInput, UpdateCityInput } from './admin-cities.service';
import { Permissions } from '../common/decorators/permissions.decorator';

interface AuthenticatedRequest extends Express.Request {
  user: { userId: number };
}

@ApiTags('Admin - Cities')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SYSTEM_ADMIN)
@Controller('admin/cities')
@Permissions(Permission.CITIES_MANAGE)
export class AdminCitiesController {
  constructor(private readonly service: AdminCitiesService) {}

  @Get()
  @ApiOperation({ summary: 'List all cities' })
  list() {
    return this.service.list();
  }

  @Post()
  @ApiOperation({ summary: 'Create a city' })
  create(@Body() input: CreateCityInput, @Request() req: AuthenticatedRequest) {
    return this.service.create(input, req.user.userId);
  }

  @Patch(':cityId')
  @ApiOperation({ summary: 'Update a city' })
  update(@Param('cityId') cityId: number, @Body() input: UpdateCityInput, @Request() req: AuthenticatedRequest) {
    return this.service.update(cityId, input, req.user.userId);
  }

  @Delete(':cityId')
  @ApiOperation({ summary: 'Soft delete a city' })
  softDelete(@Param('cityId') cityId: number, @Request() req: AuthenticatedRequest) {
    return this.service.softDelete(cityId, req.user.userId);
  }
}
