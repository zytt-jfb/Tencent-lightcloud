import { Controller, Get, Post, Param, Body, UseGuards, ParseIntPipe, Header, StreamableFile, Query, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '@biz-reporting/shared-types';
import type { RequestUserScope } from '../common/security/scope';
import { Ws6Service } from './ws6.service';
import { ConfirmImportRequestDto } from './ws6.dto';

/**
 * @deprecated 旧通用导入路径（/api/imports/*），已降级隔离。
 * 地市端新前端一律走 /api/city/import-jobs 系列接口（CityImportJobsController）。
 * 本控制器仅保留以兼容系统管理员历史入口与旧客户端，请勿在新地市前端中调用。
 */
@ApiTags('Imports (Deprecated)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SYSTEM_ADMIN, Role.CITY_USER)
@Controller('imports')
export class ImportsController {
  constructor(private readonly ws6Service: Ws6Service) {}

  @Get(':jobId/preview')
  @ApiOperation({ summary: '获取导入预览' })
  async preview(
    @Param('jobId', ParseIntPipe) jobId: number,
    @Request() req: { user: RequestUserScope },
    @Query('cityId') cityId?: string,
    @Query('reportYear') reportYear?: string,
  ) {
    return this.ws6Service.getImportPreview(
      jobId,
      cityId ? Number(cityId) : null,
      reportYear ? Number(reportYear) : null,
      req.user,
    );
  }

  @Get(':jobId/source-file')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: '下载导入源文件' })
  async sourceFile(
    @Param('jobId', ParseIntPipe) jobId: number,
    @Request() req: { user: RequestUserScope },
  ) {
    const file = await this.ws6Service.getImportSourceFile(jobId, req.user);
    return new StreamableFile(file.buffer, {
      type: file.contentType,
      disposition: `attachment; filename="${encodeURIComponent(file.fileName)}"`,
    });
  }

  @Post(':jobId/confirm')
  @ApiOperation({ summary: '确认导入' })
  async confirm(
    @Param('jobId', ParseIntPipe) jobId: number,
    @Body() dto: ConfirmImportRequestDto,
    @Request() req: { user: RequestUserScope },
  ) {
    return this.ws6Service.confirmImport(jobId, dto, req.user);
  }
}
