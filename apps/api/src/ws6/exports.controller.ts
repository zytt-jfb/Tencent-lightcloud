import { Controller, Post, Get, Body, Param, Request, UseGuards, ParseIntPipe, StreamableFile, Header, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Permissions } from '../common/decorators/permissions.decorator';
import { ExportAuditRequest, Permission, Role } from '@biz-reporting/shared-types';
import { Ws6Service } from './ws6.service';
import { CreateExportJobRequestDto } from './ws6.dto';
import { OperationLogEntity } from '../common/entities/operation-log.entity';
import type { Express } from 'express';

interface AuthenticatedRequest extends Express.Request {
  user: { userId: number; role: string; cityId: number | null };
}

@ApiTags('Exports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SYSTEM_ADMIN, Role.CITY_USER)
@Controller('exports')
export class ExportsController {
  constructor(
    private readonly ws6Service: Ws6Service,
    @InjectRepository(OperationLogEntity)
    private readonly operationLogs: Repository<OperationLogEntity>,
  ) {}

  @Post('audit')
  @Permissions(Permission.EXPORT_AUDIT)
  @ApiOperation({ summary: '记录页面数据导出结果' })
  async audit(@Body() body: ExportAuditRequest, @Request() req: AuthenticatedRequest) {
    const pageName = String(body?.pageName || '').trim().slice(0, 80);
    const rowCount = Number(body?.rowCount);
    if (!pageName || !Number.isInteger(rowCount) || rowCount < 0 || rowCount > 100000) {
      throw new BadRequestException('导出审计参数无效');
    }
    const filters = Object.fromEntries(
      Object.entries(body?.filters || {})
        .slice(0, 30)
        // PG-R12：凭证类 filter 键一律剔除（token/password/secret/jwt/credential/authorization），不写入审计
        .filter(([key]) => !/token|password|secret|jwt|credential|authorization|apikey|api_key|access_key/i.test(key))
        .map(([key, value]) => [key.slice(0, 60), String(value ?? '').slice(0, 200)]),
    );
    const result = body.result === 'success' ? 'success' : 'failed';
    await this.operationLogs.save(this.operationLogs.create({
      operatorUserId: req.user.userId,
      operatorCityId: req.user.cityId,
      actionType: 'page_export',
      targetType: 'page',
      targetId: pageName,
      summaryText: `${pageName}导出${result === 'success' ? '成功' : '失败'}，${rowCount}行`,
      beforeDataJson: null,
      afterDataJson: {
        role: req.user.role,
        scope: req.user.cityId == null ? 'province' : `city:${req.user.cityId}`,
        filters,
        rowCount,
        fileName: String(body.fileName || '').slice(0, 180) || undefined,
        errorCode: String(body.errorCode || '').slice(0, 80) || undefined,
      },
      resultStatus: result,
    }));
    return { recorded: true };
  }

  @Post()
  @ApiOperation({ summary: '创建导出任务' })
  async create(@Body() dto: CreateExportJobRequestDto, @Request() req: AuthenticatedRequest) {
    const job = await this.ws6Service.createExportJob(dto, req.user);
    return { jobId: job.id, status: job.status };
  }

  @Get(':jobId/download')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Download an export file' })
  async download(
    @Param('jobId', ParseIntPipe) jobId: number,
    @Request() req: AuthenticatedRequest,
  ) {
    const file = await this.ws6Service.getExportFile(jobId, req.user);
    return new StreamableFile(file.buffer, {
      type: file.contentType,
      disposition: `attachment; filename="${encodeURIComponent(file.fileName)}"`,
    });
  }
  @Get(':jobId')
  @ApiOperation({ summary: '获取导出任务状态' })
  async getJob(
    @Param('jobId', ParseIntPipe) jobId: number,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.ws6Service.getExportJob(jobId, req.user);
  }
}
