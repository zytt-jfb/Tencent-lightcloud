import { Controller, Get, Param, Query, Request, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission, Role } from '@biz-reporting/shared-types';
import type { FactListQuery } from '@biz-reporting/shared-types';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { FactActor, FactsService } from './facts.service';
import { FactImportService } from './fact-import.service';
import type { Response } from 'express';

interface AuthenticatedRequest extends Express.Request { user: FactActor }

@ApiTags('Admin - Facts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SYSTEM_ADMIN)
@Controller('admin/facts')
@Permissions(Permission.PROVINCE_FACTS_READ)
export class AdminFactsController {
  constructor(private readonly facts: FactsService, private readonly imports: FactImportService) {}
  @Get('costs') listCosts(@Query() query: FactListQuery, @Request() req: AuthenticatedRequest) { return this.facts.listCosts(query, req.user, true); }
  @Get('orders') listOrders(@Query() query: FactListQuery, @Request() req: AuthenticatedRequest) { return this.facts.listOrders(query, req.user, true); }
  @Get('summary') summary(@Query() query: FactListQuery, @Request() req: AuthenticatedRequest) { return this.facts.aggregate(query, req.user, true); }
  @Get('progress') progress(@Query() query: FactListQuery, @Request() req: AuthenticatedRequest) { return this.facts.listProgress(query, req.user, true); }
  @Get('import-batches') listBatches(@Query('cityId') cityId: string | undefined, @Request() req: AuthenticatedRequest) {
    return this.imports.listBatches(req.user, true, cityId ? Number(cityId) : undefined);
  }
  @Get('import-batches/:id') batchLineage(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.imports.getBatchLineage(Number(id), req.user, true);
  }
  @Get('import-batches/:id/source-file') async sourceFile(
    @Param('id') id: string, @Request() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.imports.getSourceFile(Number(id), req.user, true);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
    res.setHeader('X-Content-SHA256', file.sha256);
    return new StreamableFile(file.buffer);
  }
}
