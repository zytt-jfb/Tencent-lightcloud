import { BadRequestException, Body, Controller, Get, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Public } from '../common/decorators/public.decorator';
import { BizAuthGuard } from '../biz-auth/biz-auth.guard';
import { BizAuthUser } from '../biz-auth/biz-auth-user.decorator';
import { BizAuthContext } from '../rbac/rbac.service';
import { PerformanceService } from './performance.service';

@Controller('biz/performance') @Public() @UseGuards(BizAuthGuard)
export class PerformanceController {
  constructor(private readonly service: PerformanceService) {}
  @Get('monthly-score') monthly(@Query() q: Record<string, string>, @BizAuthUser() auth: BizAuthContext) { return this.service.monthly(q, auth); }
  @Get('overview') overview(@Query() q: Record<string, string>, @BizAuthUser() auth: BizAuthContext) { return this.service.overview(q, auth); }
  @Get('batches') batches(@BizAuthUser() auth: BizAuthContext) { return this.service.batches(auth); }
  @Post('upload') @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  upload(@UploadedFile() file: Express.Multer.File | undefined, @Body() body: Record<string, unknown>, @BizAuthUser() auth: BizAuthContext) { if (!file) throw new BadRequestException('请选择 Excel 文件'); return this.service.upload(file, auth, Number(body.assessmentYear)); }
  @Post('records') create(@Body() body: Record<string, unknown>, @BizAuthUser() auth: BizAuthContext) { return this.service.create(body, auth); }
}
