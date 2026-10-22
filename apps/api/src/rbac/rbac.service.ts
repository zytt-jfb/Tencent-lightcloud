import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PlatformRole } from '@biz-reporting/shared-types';
import { PlatformUserEntity } from './platform-user.entity';
import { RoleEntity } from './role.entity';
import { RolePermissionEntity } from './role-permission.entity';
import { UserPermissionOverrideEntity } from './user-permission-override.entity';
import { UserDataScopeEntity } from './user-data-scope.entity';
import { UserRoleEntity } from './user-role.entity';
import { UserScopeGrantEntity } from './user-scope-grant.entity';
import { AccessScopeService, AccessScopeSnapshot } from './access-scope.service';
import { CityEntity } from '../main-data/city.entity';
import { ProvinceEntity } from '../main-data/province.entity';

/** super_admin 通配标记：拥有全部权限 */
export const SUPER_ADMIN_ALL = '*';

/** 解析后的用户数据范围 */
export interface ResolvedDataScope {
  /** all=全部；province/city/contract=单一对象类型；mixed=多种范围并集；none=无范围。 */
  scopeType: 'all' | 'province' | 'city' | 'contract' | 'mixed' | 'none';
  /** scopeType=province 时允许的省份 UUID 列表；空=全部省份 */
  provinceIds: string[];
  /** scopeType=city 时绑定的地市 UUID */
  cityId: string | null;
  cityIds?: string[];
  contractIds?: string[];
  allowAll?: boolean;
  deniedProvinceIds?: string[];
  deniedCityIds?: string[];
  deniedContractIds?: string[];
}

/** 权限上下文（挂在 request.bizAuth 上，供守卫与服务使用） */
export interface BizAuthContext {
  userId: string;
  username: string;
  roleCode: PlatformRole;
  roles: string[];
  cityId: string | null;
  authVersion: number;
  sensitiveOrderScope: string;
  /** 权限码集合；isSuperAdmin=true 时忽略（通配 ALL） */
  permissionCodes: Set<string>;
  isSuperAdmin: boolean;
  dataScope: ResolvedDataScope;
}

/**
 * 权限服务（新基线）
 * 基线：01 §3.1 / 02 §1 —— "角色默认权限 + 账户级调整"合并；
 * super_admin 永久拥有全部权限；页面/API/导出三路共用本服务。
 */
@Injectable()
export class RbacService {
  /** 权限上下文短期缓存：键 `userId:authVersion`，任何权限/角色/范围/密码变更都会换键 */
  private readonly contextCache = new Map<string, { context: BizAuthContext; expiresAt: number }>();
  private static readonly AUTH_CONTEXT_CACHE_MS = 5_000;
  private static readonly AUTH_CONTEXT_CACHE_MAX = 2_000;

  constructor(
    @InjectRepository(PlatformUserEntity)
    private readonly userRepo: Repository<PlatformUserEntity>,
    @InjectRepository(RoleEntity)
    private readonly roleRepo: Repository<RoleEntity>,
    @InjectRepository(RolePermissionEntity)
    private readonly rolePermissionRepo: Repository<RolePermissionEntity>,
    @InjectRepository(UserPermissionOverrideEntity)
    private readonly overrideRepo: Repository<UserPermissionOverrideEntity>,
    @InjectRepository(UserDataScopeEntity)
    private readonly dataScopeRepo: Repository<UserDataScopeEntity>,
    @InjectRepository(UserRoleEntity)
    private readonly userRoleRepo: Repository<UserRoleEntity>,
    @InjectRepository(UserScopeGrantEntity)
    private readonly userScopeGrantRepo: Repository<UserScopeGrantEntity>,
    @InjectRepository(CityEntity)
    private readonly cityRepo: Repository<CityEntity>,
    @InjectRepository(ProvinceEntity)
    private readonly provinceRepo: Repository<ProvinceEntity>,
    private readonly accessScope: AccessScopeService,
  ) {}

  /**
   * 加载用户完整权限上下文（角色默认 + 账号例外合并）。
   * 每个请求都会走这里（biz-jwt.strategy），原实现固定 6 次查询
   * （user / userRole / role / rolePermission / override / scopeGrant）。
   * 这里加一个按 `userId + authVersion` 失效的短期缓存：
   * 改角色、改权限例外、改数据范围、改密码都会 `authVersion += 1`，因此缓存必然随之失效，
   * 「停用账号立即生效」这类安全性不受影响，只是把重复计算从 6 次查询降到 1 次。
   */
  async loadUserAuthContext(userId: string): Promise<BizAuthContext> {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('账号不存在');
    if (user.status !== 'enabled') throw new ForbiddenException('账号已被停用');

    const cacheKey = `${userId}:${user.authVersion}`;
    const cached = this.contextCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      // 返回浅拷贝 + 新的 Set：多个并发请求不能共享同一个可变 Set 实例
      return { ...cached.context, permissionCodes: new Set(cached.context.permissionCodes) };
    }

    const context = await this.buildAuthContext(user, userId);
    if (this.contextCache.size >= RbacService.AUTH_CONTEXT_CACHE_MAX) {
      // 简单的整体淘汰：缓存只做热点加速，不追求精确 LRU
      this.contextCache.clear();
    }
    this.contextCache.set(cacheKey, { context, expiresAt: Date.now() + RbacService.AUTH_CONTEXT_CACHE_MS });
    return { ...context, permissionCodes: new Set(context.permissionCodes) };
  }

  private async buildAuthContext(user: PlatformUserEntity, userId: string): Promise<BizAuthContext> {
    const bindings = await this.userRoleRepo.find({ where: { userId: user.id }, order: { isPrimary: 'DESC', createdAt: 'ASC' } });
    if (!bindings.length) throw new ForbiddenException('账号未配置角色');
    const roles = [...new Set(bindings.map((binding) => binding.roleCode))];
    const roleCode = (bindings[0].roleCode || user.roleCode) as PlatformRole;
    const isSuperAdmin = roles.includes(PlatformRole.SUPER_ADMIN);
    const dataScope = await this.resolveDataScope(user.id, isSuperAdmin);

    let permissionCodes = new Set<string>();
    if (!isSuperAdmin) {
      // 1. 角色默认权限
      const roleRows = await this.roleRepo.findBy({ code: In(roles) });
      if (roleRows.length) {
        const rolePermissions = await this.rolePermissionRepo.findBy({ roleId: In(roleRows.map((role) => role.id)) });
        for (const binding of rolePermissions) permissionCodes.add(binding.permissionCode);
      }
      // 2. 账号例外权限（allow 添加 / deny 移除）
      const overrides = await this.overrideRepo.findBy({ userId: user.id });
      for (const override of overrides) {
        if (override.effect === 'allow') permissionCodes.add(override.permissionCode);
        if (override.effect === 'deny') permissionCodes.delete(override.permissionCode);
      }
    }

    return {
      userId: user.id,
      username: user.username,
      roleCode,
      roles,
      cityId: user.cityId,
      authVersion: user.authVersion,
      sensitiveOrderScope: user.sensitiveOrderScope,
      permissionCodes,
      isSuperAdmin,
      dataScope,
    };
  }

  /** 校验权限码（super_admin 通配） */
  assertPermission(ctx: BizAuthContext, code: string): void {
    if (ctx.isSuperAdmin || ctx.permissionCodes.has(code)) return;
    throw new ForbiddenException('权限不足');
  }

  /** 解析数据范围（基线 02 §5：范围来源固定，不信任请求参数） */
  private async resolveDataScope(userId: string, isSuperAdmin: boolean): Promise<ResolvedDataScope> {
    const resolved = isSuperAdmin
      ? { allowAll: true, provinceIds: [], cityIds: [], contractIds: [], deniedProvinceIds: [], deniedCityIds: [], deniedContractIds: [], scopeType: 'all' as const, cityId: null }
      : await this.accessScope.resolve(userId);
    return resolved;
  }

  /** 校验请求中的省份参数在数据范围内 */
  async assertProvinceScope(ctx: BizAuthContext, provinceId: string | undefined | null): Promise<void> {
    if (ctx.isSuperAdmin || !provinceId) return;
    await this.accessScope.assertProvince(ctx.dataScope as AccessScopeSnapshot, provinceId);
  }

  /** 校验请求中的地市参数在数据范围内 */
  async assertCityScope(ctx: BizAuthContext, cityId: string | undefined | null): Promise<void> {
    if (ctx.isSuperAdmin || !cityId) return;
    await this.accessScope.assertCity(ctx.dataScope as AccessScopeSnapshot, cityId);
  }

  /** 批量校验地市 ID 列表（全部必须在范围内） */
  async assertCityIdsScope(ctx: BizAuthContext, cityIds: string[]): Promise<void> {
    for (const cityId of cityIds) await this.assertCityScope(ctx, cityId);
  }

  assertContractScope(ctx: BizAuthContext, contractId: string): void {
    if (ctx.isSuperAdmin) return;
    this.accessScope.assertContract(ctx.dataScope as AccessScopeSnapshot, contractId);
  }
}
