import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { BizAuthGuard } from '../biz-auth/biz-auth.guard';
import { BizPermissionsGuard } from '../biz-auth/biz-permissions.guard';
import { BizPermissions } from '../biz-auth/biz-permissions.decorator';
import { ModuleSnapshotService } from '../biz-snapshots/module-snapshot.service';
import { BizPermissionCode } from '@biz-reporting/shared-types';

/**
 * 通用模块快照 API。
 *  - GET  /biz/module-snapshots            各模块快照状态（设置页用）
 *  - GET  /biz/module-snapshots/:code      单个模块快照内容（页面首屏用）
 *  - POST /biz/module-snapshots/rebuild    立即重建（可指定模块，默认全部）
 */
@Controller('biz/module-snapshots')
@Public()
@UseGuards(BizAuthGuard, BizPermissionsGuard)
export class ModuleSnapshotController {
  constructor(private readonly service: ModuleSnapshotService) {}

  @Get()
  @BizPermissions(BizPermissionCode.OPERATION_ANALYSIS_READ)
  async list() {
    return { items: await this.service.list() };
  }

  @Get(':code')
  @BizPermissions(BizPermissionCode.OPERATION_ANALYSIS_READ)
  async get(@Param('code') code: string) {
    return this.service.get(code);
  }

  @Post('rebuild')
  @BizPermissions(BizPermissionCode.OPERATION_SETTINGS_MANAGE)
  async rebuild(@Body() body: { codes?: string[]; asOf?: string }) {
    const asOf = body?.asOf && /^\d{4}-\d{2}-\d{2}$/.test(body.asOf)
      ? body.asOf
      : ModuleSnapshotService.todayCst();
    const items = await this.service.buildAll(asOf, body?.codes);
    return { ok: true, asOf, items };
  }
}
