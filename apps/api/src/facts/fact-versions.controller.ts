import { Controller, Get, Param, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission, Role } from '@biz-reporting/shared-types';
import type { FactVersionQuery } from '@biz-reporting/shared-types';
import { Permissions } from '../common/decorators/permissions.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { FactLifecycleService } from './fact-lifecycle.service';
import type { FactActor } from './facts.service';

interface AuthenticatedRequest extends Express.Request { user: FactActor }

@ApiTags('City - Fact Versions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CITY_USER)
@Controller('city/facts/versions')
@Permissions(Permission.CITY_DATA_READ)
export class CityFactVersionsController {
  constructor(private readonly lifecycle: FactLifecycleService) {}
  @Get() list(@Query() query: FactVersionQuery, @Request() req: AuthenticatedRequest) { return this.lifecycle.listVersions(query, req.user, false); }
  @Get(':id') get(@Param('id') id: string, @Request() req: AuthenticatedRequest) { return this.lifecycle.getVersion(Number(id), req.user, false); }
}

@ApiTags('Admin - Fact Versions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SYSTEM_ADMIN)
@Controller('admin/facts/versions')
@Permissions(Permission.PROVINCE_FACTS_READ)
export class AdminFactVersionsController {
  constructor(private readonly lifecycle: FactLifecycleService) {}
  @Get() list(@Query() query: FactVersionQuery, @Request() req: AuthenticatedRequest) { return this.lifecycle.listVersions(query, req.user, true); }
  @Get(':id') get(@Param('id') id: string, @Request() req: AuthenticatedRequest) { return this.lifecycle.getVersion(Number(id), req.user, true); }
}
