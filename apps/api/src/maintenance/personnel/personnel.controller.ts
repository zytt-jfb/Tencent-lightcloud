import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards, UsePipes, ValidationPipe, UseInterceptors, UploadedFile, Res } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import type {
  MaintenanceListQuery,
  MaintenancePersonnelListResponse,
} from '@biz-reporting/shared-types';
import { MaintenancePersonnelService } from './personnel.service';
import { CreatePersonnelDto, UpdatePersonnelDto } from './personnel.dto';
import { Public } from '../../common/decorators/public.decorator';
import { BizAuthGuard } from '../../biz-auth/biz-auth.guard';
import { BizPermissions } from '../../biz-auth/biz-permissions.decorator';
import { BizPermissionsGuard } from '../../biz-auth/biz-permissions.guard';
import { BizAuthUser } from '../../biz-auth/biz-auth-user.decorator';
import { MaintenanceDocumentService } from '../maintenance-document.service';
import { BizAuthContext } from '../../rbac/rbac.service';

@Controller('biz/maintenance/personnel')
@Public()
@UseGuards(BizAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class MaintenancePersonnelController {
  constructor(private readonly service: MaintenancePersonnelService, private readonly documents: MaintenanceDocumentService) {}

  @Get()
  list(@Query() query: MaintenanceListQuery): Promise<MaintenancePersonnelListResponse> {
    return this.service.list(query);
  }

  @Post() create(@Body() dto: CreatePersonnelDto, @BizAuthUser() auth: BizAuthContext) { return this.service.create(dto, auth); }
  @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdatePersonnelDto, @BizAuthUser() auth: BizAuthContext) { return this.service.update(id, dto, auth); }
  @Get(':id/documents') listDocuments(@Param('id') id: string, @BizAuthUser() auth: BizAuthContext) { return this.service.listDocuments(id, auth); }
  @Get('documents/pending') listPendingDocuments(@BizAuthUser() auth: BizAuthContext) { return this.documents.listPending('personnel', auth); }
  @Post('documents/upload') @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } }))
  uploadDocument(@UploadedFile() file: Express.Multer.File | undefined, @Query('category') category: string, @BizAuthUser() auth: BizAuthContext) { return this.documents.upload('personnel', category, file as Express.Multer.File, auth); }
  @Get('documents/:documentId/download')
  async downloadDocument(@Param('documentId') id: string, @BizAuthUser() auth: BizAuthContext, @Res() response: Response) { const file=await this.documents.download(id, auth); response.setHeader('Content-Type', file.mimeType); response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`); response.send(file.buffer); }
  @Delete(':id') @UseGuards(BizPermissionsGuard) @BizPermissions('maintenance.data.delete') remove(@Param('id') id: string) { return this.service.remove(id); }
}


