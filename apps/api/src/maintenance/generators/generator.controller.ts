import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors, UsePipes, ValidationPipe } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import type { MaintenanceListQuery } from '@biz-reporting/shared-types';
import { BizAuthGuard } from '../../biz-auth/biz-auth.guard';
import { BizAuthUser } from '../../biz-auth/biz-auth-user.decorator';
import { BizPermissions } from '../../biz-auth/biz-permissions.decorator';
import { BizPermissionsGuard } from '../../biz-auth/biz-permissions.guard';
import { Public } from '../../common/decorators/public.decorator';
import { BizAuthContext } from '../../rbac/rbac.service';
import { MaintenanceDocumentService } from '../maintenance-document.service';
import { CreateGeneratorDto, UpdateGeneratorDto } from './generator.dto';
import { MaintenanceGeneratorService } from './generator.service';

@Controller('biz/maintenance/generators')
@Public()
@UseGuards(BizAuthGuard)
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class MaintenanceGeneratorController {
  constructor(private readonly service: MaintenanceGeneratorService, private readonly documents: MaintenanceDocumentService) {}
  @Get() list(@Query() q: MaintenanceListQuery) { return this.service.list(q); }
  @Post() create(@Body() dto: CreateGeneratorDto, @BizAuthUser() auth: BizAuthContext) { return this.service.create(dto, auth); }
  @Patch(':id') update(@Param('id') id: string, @Body() dto: UpdateGeneratorDto, @BizAuthUser() auth: BizAuthContext) { return this.service.update(id, dto, auth); }
  @Get(':id/documents') listDocuments(@Param('id') id: string, @BizAuthUser() auth: BizAuthContext) { return this.service.listDocuments(id, auth); }
  @Get('documents/pending') listPendingDocuments(@BizAuthUser() auth: BizAuthContext) { return this.documents.listPending('generators', auth); }
  @Post('documents/upload') @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } }))
  uploadDocument(@UploadedFile() file: Express.Multer.File | undefined, @Query('category') category: string, @BizAuthUser() auth: BizAuthContext) { return this.documents.upload('generators', category, file as Express.Multer.File, auth); }
  @Get('documents/:documentId/download') async downloadDocument(@Param('documentId') id: string, @BizAuthUser() auth: BizAuthContext, @Res() response: Response) { const file = await this.documents.download(id, auth); response.setHeader('Content-Type', file.mimeType); response.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`); response.send(file.buffer); }
  @Delete(':id') @UseGuards(BizPermissionsGuard) @BizPermissions('maintenance.data.delete') remove(@Param('id') id: string) { return this.service.remove(id); }
}
