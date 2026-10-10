import {
  Controller, Post, Get, Request, Param, Body, UseGuards, UseInterceptors,
  UploadedFile, ParseIntPipe, BadRequestException,
  Query,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role, ImportJobType } from '@biz-reporting/shared-types';
import { CITY_COST_IMPORT_JOB_TYPE, Ws6Service } from './ws6.service';
import { ImportJobListQueryDto } from './ws6.dto';
import { importUploadOptions } from './import-upload.config';

interface AuthenticatedRequest extends Express.Request {
  user: { userId: number; role: Role; cityId: number | null };
  body?: Record<string, unknown>;
}

const SUPPORTED_CITY_JOB_TYPES = ['city_reporting', CITY_COST_IMPORT_JOB_TYPE] as const;

@ApiTags('City - Import Jobs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.CITY_USER)
@Controller('city/import-jobs')
export class CityImportJobsController {
  constructor(private readonly ws6Service: Ws6Service) {}

  @Get()
  @ApiOperation({ summary: '查询当前用户、当前地市的导入任务' })
  list(
    @Query() query: ImportJobListQueryDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.ws6Service.listImportJobs(query, req.user);
  }

  @Post()
  @UseInterceptors(FileInterceptor('file', importUploadOptions()))
  @ApiOperation({ summary: '地市用户创建导入作业（报表/成本），绑定当前用户与地市' })
  async create(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Request() req: AuthenticatedRequest,
  ) {
    if (!file) throw new BadRequestException('请上传文件');
    const body = (req.body || {}) as Record<string, unknown>;
    const jobType = body.jobType;
    if (typeof jobType !== 'string' || !(SUPPORTED_CITY_JOB_TYPES as readonly string[]).includes(jobType)) {
      throw new BadRequestException('jobType 必须为 city_reporting 或 city_cost');
    }
    const reportYearRaw = body.reportYear;
    const reportYear = Number(reportYearRaw);
    if (!Number.isInteger(reportYear) || reportYear < 2000 || reportYear > 2100) {
      throw new BadRequestException('reportYear 必须为 2000-2100 之间的整数');
    }
    if (req.user.cityId === null) {
      throw new BadRequestException('当前账号未关联地市，无法创建导入任务');
    }
    const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const job = await this.ws6Service.createImportJob({
      jobType: jobType as ImportJobType | typeof CITY_COST_IMPORT_JOB_TYPE,
      operatorUserId: req.user.userId,
      cityId: req.user.cityId,
      reportYear,
      sourceFileName: fileName,
      sourceFileBuffer: file.buffer,
    });
    return {
      jobId: job.id,
      status: job.status,
      jobType: job.jobType,
      operatorUserId: job.operatorUserId,
      cityId: job.cityId,
      reportYear: job.reportYear,
      filename: fileName,
      sourceFileUrl: job.sourceFileUrl,
    };
  }

  @Get(':jobId')
  @ApiOperation({ summary: '获取导入作业详情' })
  async getOne(
    @Param('jobId', ParseIntPipe) jobId: number,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.ws6Service.getCityImportJob(jobId, req.user);
  }

  @Get(':jobId/preview')
  @ApiOperation({ summary: '获取导入预览（使用作业自身绑定的地市与年份）' })
  async preview(
    @Param('jobId', ParseIntPipe) jobId: number,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.ws6Service.previewCityImport(jobId, req.user);
  }

  @Post(':jobId/confirm')
  @ApiOperation({ summary: '确认导入写入（使用作业自身绑定的地市与年份）' })
  async confirm(
    @Param('jobId', ParseIntPipe) jobId: number,
    @Body() body: { confirmOverwrite?: boolean },
    @Request() req: AuthenticatedRequest,
  ) {
    const confirmOverwrite = body?.confirmOverwrite === true;
    return this.ws6Service.confirmCityImport(jobId, req.user, confirmOverwrite);
  }

  @Post(':jobId/cancel')
  @ApiOperation({ summary: '取消导入作业' })
  async cancel(
    @Param('jobId', ParseIntPipe) jobId: number,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.ws6Service.cancelCityImport(jobId, req.user);
  }

  @Post(':jobId/retry')
  @ApiOperation({ summary: '受控重试失败导入作业（FAILED → PENDING，attempt<3 且 failureCode 白名单）' })
  async retry(
    @Param('jobId', ParseIntPipe) jobId: number,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.ws6Service.retryImportJob(jobId, req.user);
  }
}
