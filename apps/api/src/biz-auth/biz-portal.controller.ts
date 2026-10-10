import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Public } from '../common/decorators/public.decorator';
import { BizAuthGuard } from './biz-auth.guard';
import { BizPermissionsGuard } from './biz-permissions.guard';
import { BizPermissions } from './biz-permissions.decorator';
import { BizAuthContext } from '../rbac/rbac.service';
import { BizAuthUser } from './biz-auth-user.decorator';
import { ModuleEntity } from '../rbac/module.entity';
import { BizPermissionCode } from '@biz-reporting/shared-types';

const MODULE_ENTER_PERMISSION: Record<string, string> = {
  engineering: BizPermissionCode.PORTAL_ENGINEERING_ENTER,
  maintenance: BizPermissionCode.PORTAL_MAINTENANCE_ENTER,
  operation: BizPermissionCode.MAINTENANCE_OPERATION_ENTER,
  asset: BizPermissionCode.MAINTENANCE_ASSET_ENTER,
  personnel: BizPermissionCode.MAINTENANCE_PERSONNEL_ENTER,
};

/**
 * 两级门户 API（新基线）
 * 基线：01 §2 / 06 §2 —— 登录后进入一级门户，仅展示有权模块；无权限路由 403。
 * 占位模块（engineering/asset/personnel）仅返回"建设中"元信息，不读取经营数据。
 */
@Controller('biz/portal')
@UseGuards(BizAuthGuard, BizPermissionsGuard)
export class BizPortalController {
  constructor(
    @InjectRepository(ModuleEntity)
    private readonly moduleRepo: Repository<ModuleEntity>,
  ) {}

  /** 一级 + 二级模块树（按当前账号权限过滤） */
  @Get('modules')
  @Public()
  async modules(@BizAuthUser() auth: BizAuthContext) {
    const all = await this.moduleRepo.find({ order: { sortOrder: 'ASC' } });
    const allowed = (code: string) =>
      auth.isSuperAdmin ||
      auth.permissionCodes.has(MODULE_ENTER_PERMISSION[code] ?? '');

    const level1 = all
      .filter((m) => m.level === 'level1' && allowed(m.code))
      .map((m) => ({ id: m.id, code: m.code, name: m.name, level: m.level, sortOrder: m.sortOrder }));
    const level2 = all
      .filter((m) => m.level === 'level2' && allowed(m.code))
      .map((m) => ({ id: m.id, code: m.code, name: m.name, level: m.level, parentId: m.parentId, sortOrder: m.sortOrder }));

    if (auth.isSuperAdmin || auth.permissionCodes.has('portal.system.enter')) {
      level1.push({ id: 'system-settings', code: 'system', name: '系统设置', level: 'level1', sortOrder: 100 });
    }
    return { level1, level2 };
  }

  /** 占位模块（建设中）元信息：不读取任何经营数据 */
  @Get('placeholder/:code')
  @Public()
  async placeholder(@BizAuthUser() auth: BizAuthContext, @Param('code') code: string) {
    if (!['engineering', 'asset', 'personnel'].includes(code)) {
      return { code, found: false, message: '未知模块' };
    }
    if (!auth.isSuperAdmin && !auth.permissionCodes.has(MODULE_ENTER_PERMISSION[code] ?? '')) {
      return { code, found: true, message: '建设中', accessible: false };
    }
    return { code, found: true, message: '建设中', accessible: true };
  }
}
