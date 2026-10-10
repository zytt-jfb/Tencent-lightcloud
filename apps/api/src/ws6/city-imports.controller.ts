import {
  Controller, Post, Request, UseGuards, UseInterceptors,
  UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { ImportJobType } from '@biz-reporting/shared-types';
import { Role } from '@biz-reporting/shared-types';
import { CITY_COST_IMPORT_JOB_TYPE, Ws6Service } from './ws6.service';
import { importUploadOptions } from './import-upload.config';

interface AuthenticatedRequest extends Express.Request {
  user: { userId: number; role: string; cityId: number | null };
}

/**
 * @deprecated 旧地市导入上传路径（/api/city/imports/*），已降级隔离。
 * 新前端一律走 /api/city/import-jobs 系列接口（CityImportJobsController）。
 * 本控制器仅保留以兼容历史客户端，请勿在新前端中调用；后续可在确认无历史调用后移除。
 */
@ApiTags('City - Imports (Deprecated)')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CITY_USER)
@Controller('city/imports')
export class CityImportsController {
  constructor(private readonly ws6Service: Ws6Service) {}

  @Post('reporting/upload')
  @UseInterceptors(FileInterceptor('file', importUploadOptions()))
  @ApiOperation({ summary: '上传合同草稿导入文件（合同维度逐月完工/审定）' })
  async uploadReporting(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.createFileJob(file, req, ImportJobType.CITY_REPORTING);
  }

  @Post('cost/upload')
  @UseInterceptors(FileInterceptor('file', importUploadOptions()))
  @ApiOperation({ summary: '上传成本导入文件' })
  async uploadCost(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.createFileJob(file, req, CITY_COST_IMPORT_JOB_TYPE);
  }

  private async createFileJob(
    file: Express.Multer.File | undefined,
    req: AuthenticatedRequest,
    jobType: ImportJobType.CITY_REPORTING | typeof CITY_COST_IMPORT_JOB_TYPE,
  ) {
    if (!file) throw new BadRequestException('请上传文件');
    const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const job = await this.ws6Service.createImportJob({
      jobType,
      operatorUserId: req.user.userId,
      cityId: req.user.cityId,
      sourceFileName: fileName,
      sourceFileBuffer: file.buffer,
    });
    return { jobId: job.id, status: job.status, filename: fileName, sourceFileUrl: job.sourceFileUrl };
  }
}
