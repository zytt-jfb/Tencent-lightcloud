import {
  BadRequestException,
  Body,
  Controller,
  Post,
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
import { Ws6Service } from './ws6.service';
import { importUploadOptions } from './import-upload.config';

interface AuthenticatedRequest extends Express.Request {
  user: { userId: number; role: string; cityId: number | null };
}

@ApiTags('Admin - Imports')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SYSTEM_ADMIN)
@Controller('admin/imports')
export class AdminImportsController {
  constructor(private readonly ws6Service: Ws6Service) {}

  @Post('contracts/upload')
  @UseInterceptors(FileInterceptor('file', importUploadOptions()))
  @ApiOperation({ summary: '上传合同导入文件' })
  async uploadContracts(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.createFileJob(file, req, ImportJobType.CONTRACT, null);
  }

  @Post('reporting/upload')
  @UseInterceptors(FileInterceptor('file', importUploadOptions()))
  @ApiOperation({ summary: '上传全地市报表导入文件' })
  async uploadReporting(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Request() req: AuthenticatedRequest,
    @Body('cityId') cityId?: string,
  ) {
    return this.createFileJob(file, req, ImportJobType.CITY_REPORTING, cityId ? Number(cityId) : null);
  }

  private async createFileJob(
    file: Express.Multer.File | undefined,
    req: AuthenticatedRequest,
    jobType: ImportJobType,
    cityId: number | null,
  ) {
    if (!file) throw new BadRequestException('请上传文件');
    const fileName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const job = await this.ws6Service.createImportJob({
      jobType,
      operatorUserId: req.user.userId,
      cityId,
      sourceFileName: fileName,
      sourceFileBuffer: file.buffer,
    });
    return {
      jobId: job.id,
      status: job.status,
      filename: fileName,
      sourceFileUrl: job.sourceFileUrl,
    };
  }
}
