import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ImportJobType, Role } from '@biz-reporting/shared-types';
import { Roles } from '../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import type { RequestUserScope } from '../common/security/scope';
import { ConfirmImportRequestDto, ImportJobListQueryDto } from './ws6.dto';
import { importUploadOptions } from './import-upload.config';
import { Ws6Service } from './ws6.service';

interface AuthenticatedRequest extends Express.Request {
  user: RequestUserScope;
  body?: Record<string, unknown>;
}

const SUPPORTED_ADMIN_JOB_TYPES = [
  ImportJobType.CONTRACT,
  ImportJobType.CITY_REPORTING,
  ImportJobType.CITY_COST,
] as const;

@ApiTags('Admin - Import Jobs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SYSTEM_ADMIN)
@Controller('admin/import-jobs')
export class AdminImportJobsController {
  constructor(private readonly ws6Service: Ws6Service) {}

  @Post()
  @UseInterceptors(FileInterceptor('file', importUploadOptions()))
  @ApiOperation({ summary: '管理员创建合同、报表或成本导入任务' })
  async create(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Request() req: AuthenticatedRequest,
  ) {
    if (!file) throw new BadRequestException('请上传文件');
    const body = req.body ?? {};
    const jobType = body.jobType;
    if (
      typeof jobType !== 'string'
      || !(SUPPORTED_ADMIN_JOB_TYPES as readonly string[]).includes(jobType)
    ) {
      throw new BadRequestException('jobType 必须为 contract、city_reporting 或 city_cost');
    }

    const isContract = jobType === ImportJobType.CONTRACT;
    const cityId = Number(body.cityId);
    const reportYear = Number(body.reportYear);
    if (!isContract && (!Number.isInteger(cityId) || cityId <= 0)) {
      throw new BadRequestException('报表或成本导入必须选择地市');
    }
    if (!isContract && (!Number.isInteger(reportYear) || reportYear < 2000 || reportYear > 2100)) {
      throw new BadRequestException('reportYear 必须为 2000-2100 之间的整数');
    }

    const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const job = await this.ws6Service.createImportJob({
      jobType: jobType as ImportJobType,
      operatorUserId: req.user.userId,
      cityId: isContract ? null : cityId,
      reportYear: isContract ? null : reportYear,
      sourceFileName: fileName,
      sourceFileBuffer: file.buffer,
    });
    return this.ws6Service.getImportJobDetail(job.id, req.user);
  }

  @Get()
  @ApiOperation({ summary: '分页查询导入任务' })
  list(
    @Query() query: ImportJobListQueryDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.ws6Service.listImportJobs(query, req.user);
  }

  @Get(':jobId')
  @ApiOperation({ summary: '查询导入任务详情' })
  detail(
    @Param('jobId', ParseIntPipe) jobId: number,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.ws6Service.getImportJobDetail(jobId, req.user);
  }

  @Get(':jobId/preview')
  @ApiOperation({ summary: '解析并获取导入预览' })
  preview(
    @Param('jobId', ParseIntPipe) jobId: number,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.ws6Service.previewBoundImport(jobId, req.user);
  }

  @Post(':jobId/confirm')
  @ApiOperation({ summary: '确认导入并写入业务表' })
  confirm(
    @Param('jobId', ParseIntPipe) jobId: number,
    @Body() dto: ConfirmImportRequestDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.ws6Service.confirmBoundImport(jobId, req.user, dto.confirmOverwrite);
  }

  @Post(':jobId/cancel')
  @ApiOperation({ summary: '取消未完成导入任务' })
  cancel(
    @Param('jobId', ParseIntPipe) jobId: number,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.ws6Service.cancelImportJob(jobId, req.user);
  }

  @Post(':jobId/retry')
  @ApiOperation({ summary: '受控重试失败导入任务（FAILED → PENDING，attempt<3 且 failureCode 白名单）' })
  retry(
    @Param('jobId', ParseIntPipe) jobId: number,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.ws6Service.retryImportJob(jobId, req.user);
  }
}
