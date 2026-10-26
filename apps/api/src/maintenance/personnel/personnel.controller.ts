import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, UsePipes, ValidationPipe, UseInterceptors, UploadedFile, Res } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  MaintenanceListQuery,
  MaintenancePersonnelListResponse,
} from '@biz-reporting/shared-types';
import { BizPermissionCode } from '@biz-reporting/shared-types';
import { MaintenancePersonnelService } from './personnel.service';
import { MaintenancePersonnelEntity } from './personnel.entity';
import { CreatePersonnelDto, UpdatePersonnelDto } from './personnel.dto';
import { Public } from '../../common/decorators/public.decorator';
import { BizAuthGuard } from '../../biz-auth/biz-auth.guard';
import { BizPermissions } from '../../biz-auth/biz-permissions.decorator';
import { BizPermissionsGuard } from '../../biz-auth/biz-permissions.guard';
import { BizAuthUser } from '../../biz-auth/biz-auth-user.decorator';
import { MaintenanceDocumentService } from '../maintenance-document.service';
import { MaintenanceBatchImportService } from '../maintenance-batch-import.service';
import { PERSONNEL_IMPORT_SPEC } from '../batch-import-specs';
import { BizAuthContext } from '../../rbac/rbac.service';

@Controller('biz/maintenance/personnel')
@Public()
@UseGuards(BizAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class MaintenancePersonnelController {
  constructor(
    private readonly service: MaintenancePersonnelService,
    private readonly documents: MaintenanceDocumentService,
    private readonly batchImport: MaintenanceBatchImportService,
    @InjectRepository(MaintenancePersonnelEntity) private readonly repo: Repository<MaintenancePersonnelEntity>,
  ) {}

  @Get() @UseGuards(BizPermissionsGuard) @BizPermissions('maintenance.personnel.enter') list(@Query() query: MaintenanceListQuery, @BizAuthUser() auth: BizAuthContext): Promise<MaintenancePersonnelListResponse> {
    return this.service.list(query, auth);
  }

  @Post() @UseGuards(BizPermissionsGuard) @BizPermissions('maintenance.data.write') create(@Body() dto: CreatePersonnelDto, @BizAuthUser() auth: BizAuthContext) { return this.service.create(dto, auth); }
  @Patch(':id') @UseGuards(BizPermissionsGuard) @BizPermissions('maintenance.data.write') update(@Param('id') id: string, @Body() dto: UpdatePersonnelDto, @BizAuthUser() auth: BizAuthContext) { return this.service.update(id, dto, auth); }
  @Get(':id/documents') @UseGuards(BizPermissionsGuard) @BizPermissions('maintenance.personnel.enter') listDocuments(@Param('id') id: string, @BizAuthUser() auth: BizAuthContext) { return this.service.listDocuments(id, auth); }
  @Get('documents/pending') @UseGuards(BizPermissionsGuard) @BizPermissions('maintenance.personnel.enter') listPendingDocuments(@BizAuthUser() auth: BizAuthContext) { return this.documents.listPending('personnel', auth); }
  @Post('documents/upload') @UseGuards(BizPermissionsGuard) @BizPermissions('maintenance.data.write') @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } }))
  uploadDocument(@UploadedFile() file: Express.Multer.File | undefined, @Query('category') category: string, @BizAuthUser() auth: BizAuthContext) { return this.documents.upload('personnel', category, file as Express.Multer.File, auth); }
  @Get('documents/:documentId/download') @UseGuards(BizPermissionsGuard) @BizPermissions('maintenance.personnel.enter')
  async downloadDocument(@Param('documentId') id: string, @BizAuthUser() auth: BizAuthContext, @Res() response: Response) { const file=await this.documents.download(id, auth); response.setHeader('Content-Type', file.mimeType); response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`); response.send(file.buffer); }
  @Delete(':id') @UseGuards(BizPermissionsGuard) @BizPermissions('maintenance.data.delete') remove(@Param('id') id: string) { return this.service.remove(id); }

  // ---------------------------------------------------------------------------
  // 批量导入
  // 装饰器只声明「独立开关」这一道闸；模块写权限在 service 里二次校验（AND 语义）。
  // BizPermissionsGuard 是 OR 语义，两个码写在装饰器里会变成「有一个就放行」。
  // ---------------------------------------------------------------------------
  @Get('import/template') @UseGuards(BizPermissionsGuard) @BizPermissions(BizPermissionCode.ASSISTANT_IMPORT_EXECUTE)
  importTemplate(@BizAuthUser() auth: BizAuthContext, @Res() response: Response) {
    this.batchImport.assertCanImport(auth, 'maintenance.data.write');
    const buffer = this.batchImport.template(PERSONNEL_IMPORT_SPEC);
    response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent('人员导入模板.xlsx')}`);
    response.send(buffer);
  }

  @Post('import/preview') @UseGuards(BizPermissionsGuard) @BizPermissions(BizPermissionCode.ASSISTANT_IMPORT_EXECUTE)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  async importPreview(@UploadedFile() file: Express.Multer.File | undefined, @BizAuthUser() auth: BizAuthContext) {
    this.batchImport.assertCanImport(auth, 'maintenance.data.write');
    if (!file?.buffer?.length) throw new BadRequestException('请选择要导入的 Excel 文件');
    return this.batchImport.preview(this.repo, PERSONNEL_IMPORT_SPEC, auth, file.buffer);
  }

  @Post('import') @UseGuards(BizPermissionsGuard) @BizPermissions(BizPermissionCode.ASSISTANT_IMPORT_EXECUTE)
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } }))
  async importCommit(@UploadedFile() file: Express.Multer.File | undefined, @BizAuthUser() auth: BizAuthContext) {
    this.batchImport.assertCanImport(auth, 'maintenance.data.write');
    if (!file?.buffer?.length) throw new BadRequestException('请选择要导入的 Excel 文件');
    return this.batchImport.commit(this.repo, PERSONNEL_IMPORT_SPEC, auth, file.buffer, file.originalname);
  }
}


