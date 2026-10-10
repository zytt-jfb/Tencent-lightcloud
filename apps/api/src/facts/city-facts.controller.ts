import { Body, Controller, Get, GoneException, Param, Patch, Post, Query, Request, Res, StreamableFile, UploadedFile, UseGuards, UseInterceptors, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permission, Role } from '@biz-reporting/shared-types';
import type { CreateCostFactRequest, CreateOrderFactRequest, FactListQuery, ReverseFactRequest, UpdateCostFactRequest, UpdateOrderFactRequest } from '@biz-reporting/shared-types';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Permissions } from '../common/decorators/permissions.decorator';
import { FactImportService } from './fact-import.service';
import { FactLifecycleService } from './fact-lifecycle.service';
import { FactActor, FactsService } from './facts.service';
import type { Response } from 'express';

interface AuthenticatedRequest extends Express.Request { user: FactActor }

@ApiTags('City - Facts')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CITY_USER)
@Controller('city/facts')
@Permissions(Permission.CITY_DATA_READ)
export class CityFactsController {
  constructor(
    private readonly facts: FactsService,
    private readonly imports: FactImportService,
    private readonly lifecycle: FactLifecycleService,
  ) {}

  @Get('costs') listCosts(@Query() query: FactListQuery, @Request() req: AuthenticatedRequest) { return this.facts.listCosts(query, req.user); }
  @Post('costs') @Permissions(Permission.CITY_DATA_WRITE) createCost(_dto: CreateCostFactRequest, _req: AuthenticatedRequest) { throw new GoneException('旧 facts 体系已退役，仅支持读取'); }
  @Patch('costs/:id') @Permissions(Permission.CITY_DATA_WRITE) updateCost(_id: string, _dto: UpdateCostFactRequest, _req: AuthenticatedRequest) { throw new GoneException('旧 facts 体系已退役，仅支持读取'); }
  @Post('costs/:id/reverse') @Permissions(Permission.CITY_DATA_WRITE) reverseCost(_id: string, _dto: ReverseFactRequest, _req: AuthenticatedRequest) { throw new GoneException('旧 facts 体系已退役，仅支持读取'); }

  @Post('costs/import')
  @Permissions(Permission.CITY_IMPORT)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }))
  importCosts(@UploadedFile() file: Express.Multer.File | undefined, @Body('templateType') templateType: string | undefined,
    @Body('contractCode') contractCode: string | undefined, @Request() req: AuthenticatedRequest) {
    if (!file) throw new BadRequestException('请上传 Excel 文件');
    throw new GoneException('旧 facts 体系已退役，仅支持读取');
  }

  @Get('orders') listOrders(@Query() query: FactListQuery, @Request() req: AuthenticatedRequest) { return this.facts.listOrders(query, req.user); }
  @Post('orders') @Permissions(Permission.CITY_DATA_WRITE) createOrder(_dto: CreateOrderFactRequest, _req: AuthenticatedRequest) { throw new GoneException('旧 facts 体系已退役，仅支持读取'); }
  @Patch('orders/:id') @Permissions(Permission.CITY_DATA_WRITE) updateOrder(_id: string, _dto: UpdateOrderFactRequest, _req: AuthenticatedRequest) { throw new GoneException('旧 facts 体系已退役，仅支持读取'); }
  @Post('orders/:id/reverse') @Permissions(Permission.CITY_DATA_WRITE) reverseOrder(_id: string, _dto: ReverseFactRequest, _req: AuthenticatedRequest) { throw new GoneException('旧 facts 体系已退役，仅支持读取'); }

  @Post('orders/import')
  @Permissions(Permission.CITY_IMPORT)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } }))
  importOrders(@UploadedFile() file: Express.Multer.File | undefined, @Request() req: AuthenticatedRequest) {
    if (!file) throw new BadRequestException('请上传 Excel 文件');
    throw new GoneException('旧 facts 体系已退役，仅支持读取');
  }

  @Get('contracts') localContracts(@Query() query: FactListQuery, @Request() req: AuthenticatedRequest) { return this.facts.localContracts(query, req.user); }
  @Get('summary') summary(@Query() query: FactListQuery, @Request() req: AuthenticatedRequest) { return this.facts.aggregate(query, req.user, false); }

  @Get('import-batches') listBatches(@Request() req: AuthenticatedRequest) { return this.imports.listBatches(req.user); }
  @Get('import-batches/:id') batchLineage(@Param('id') id: string, @Request() req: AuthenticatedRequest) {
    return this.imports.getBatchLineage(Number(id), req.user);
  }
  @Get('import-batches/:id/source-file') async sourceFile(
    @Param('id') id: string, @Request() req: AuthenticatedRequest, @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.imports.getSourceFile(Number(id), req.user);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`);
    res.setHeader('X-Content-SHA256', file.sha256);
    return new StreamableFile(file.buffer);
  }
}

