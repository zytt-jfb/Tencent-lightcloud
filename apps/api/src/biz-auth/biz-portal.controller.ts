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
import { PortalDomain, type PortalDomainValue } from '@biz-reporting/shared-types';

/**
 * 一级模块（engineering / maintenance / operation）的可见性按「域」判定：
 * 拥有该模块下任意一个权限即可进入，不再要求单独的 portal.*.enter。
 * 二级模块（asset / personnel）沿用细粒度权限码 —— 它们是同一域下的并列子集，
 * 用域判定会把「只有资产管理权限的人」也放进人员管理。
 */
const LEVEL1_DOMAIN: Record<string, PortalDomainValue> = {
  engineering: PortalDomain.ENGINEERING,
  maintenance: PortalDomain.MAINTENANCE,
  operation: PortalDomain.OPERATION,
};

const LEVEL2_PERMISSION: Record<string, string> = {
  asset: 'maintenance.asset.enter',
  personnel: 'maintenance.personnel.enter',
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
    const allowed = (code: string) => this.canEnterModule(auth, code);

    const level1 = all
      .filter((m) => m.level === 'level1' && allowed(m.code))
      .map((m) => ({ id: m.id, code: m.code, name: m.name, level: m.level, sortOrder: m.sortOrder }));
    const level2 = all
      .filter((m) => m.level === 'level2' && allowed(m.code))
      .map((m) => ({ id: m.id, code: m.code, name: m.name, level: m.level, parentId: m.parentId, sortOrder: m.sortOrder }));

    if (auth.isSuperAdmin || auth.modulePermissions.has(PortalDomain.SYSTEM)) {
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
    return { code, found: true, message: '建设中', accessible: this.canEnterModule(auth, code) };
  }

  /** 一级模块看域、二级模块看细粒度权限码（详见文件顶部的常量注释） */
  private canEnterModule(auth: BizAuthContext, code: string): boolean {
    if (auth.isSuperAdmin) return true;
    const domain = LEVEL1_DOMAIN[code];
    if (domain) return auth.modulePermissions.has(domain);
    const permission = LEVEL2_PERMISSION[code];
    return permission ? auth.permissionCodes.has(permission) : false;
  }
}
