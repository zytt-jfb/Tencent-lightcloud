import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository, In, IsNull } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { PlatformRole, PLATFORM_ROLES } from '@biz-reporting/shared-types';
import { PlatformUserEntity } from '../rbac/platform-user.entity';
import { RoleEntity } from '../rbac/role.entity';
import { ModuleEntity } from '../rbac/module.entity';
import { PermissionEntity } from '../rbac/permission.entity';
import { RolePermissionEntity } from '../rbac/role-permission.entity';
import { UserPermissionOverrideEntity } from '../rbac/user-permission-override.entity';
import { UserDataScopeEntity } from '../rbac/user-data-scope.entity';
import { UserRoleEntity } from '../rbac/user-role.entity';
import { UserScopeGrantEntity, UserScopeGrantType } from '../rbac/user-scope-grant.entity';
import { ProvinceEntity } from '../main-data/province.entity';
import { CityEntity } from '../main-data/city.entity';
import { BizOperationLogEntity } from '../operation-logs/biz-operation-log.entity';

export interface CreateUserDto {
  username: string;
  password: string;
  name: string;
  roleCode: PlatformRole;
  /** 绑定地市（多选）。city_user 至少选一个；多城市时 user.cityId 取第一个作为主城市 */
  cityIds?: string[] | null;
  sensitiveOrderScope?: 'full' | 'masked';
}

export interface PermissionOverrideInput {
  permissionCode: string;
  effect: 'allow' | 'deny';
}

export interface DataScopeInput {
  provinceId: string | null;
  cityId?: string | null;
}
export interface ScopeGrantInput { scopeType: UserScopeGrantType; targetId?: string | null; effect?: 'allow' | 'deny'; }

export interface ProvinceInput { code: string; name: string; }
export interface CityInput { provinceId: string; code: string; name: string; unitType?: 'city' | 'province_branch'; }

/**
 * 账号与权限管理服务（新基线，仅 super_admin）
 * 基线：01 §3 / 02 —— 创建/停用/重置、角色默认权限+账号例外、数据范围；
 * 停用/重置密码 → authVersion+1 使旧会话立即失效；权限变更下次登录生效。
 */
@Injectable()
export class BizAdminService {
  constructor(
    @InjectRepository(PlatformUserEntity)
    private readonly userRepo: Repository<PlatformUserEntity>,
    @InjectRepository(RoleEntity)
    private readonly roleRepo: Repository<RoleEntity>,
    @InjectRepository(ModuleEntity)
    private readonly moduleRepo: Repository<ModuleEntity>,
    @InjectRepository(PermissionEntity)
    private readonly permissionRepo: Repository<PermissionEntity>,
    @InjectRepository(RolePermissionEntity)
    private readonly rolePermissionRepo: Repository<RolePermissionEntity>,
    @InjectRepository(UserPermissionOverrideEntity)
    private readonly overrideRepo: Repository<UserPermissionOverrideEntity>,
    @InjectRepository(UserDataScopeEntity)
    private readonly dataScopeRepo: Repository<UserDataScopeEntity>,
    @InjectRepository(UserRoleEntity)
    private readonly userRoleRepo: Repository<UserRoleEntity>,
    @InjectRepository(UserScopeGrantEntity)
    private readonly scopeGrantRepo: Repository<UserScopeGrantEntity>,
    @InjectRepository(ProvinceEntity)
    private readonly provinceRepo: Repository<ProvinceEntity>,
    @InjectRepository(CityEntity)
    private readonly cityRepo: Repository<CityEntity>,
    @InjectRepository(BizOperationLogEntity)
    private readonly opLogRepo: Repository<BizOperationLogEntity>,
    private readonly dataSource: DataSource,
  ) {}

  private async recordOp(operatorUserId: string, actionType: string, targetType: string, targetId: string): Promise<void> {
    await this.opLogRepo.save({
      id: randomUUID(),
      operatorUserId,
      actionType,
      targetType,
      targetId,
      resultStatus: 'success',
    });
  }

  // ================= 用户 =================

  async listUsers(): Promise<PlatformUserEntity[]> {
    return this.userRepo.find({ order: { createdAt: 'DESC' } });
  }

  async createUser(operatorId: string, dto: CreateUserDto): Promise<PlatformUserEntity> {
    if (!PLATFORM_ROLES.includes(dto.roleCode)) throw new BadRequestException('非法角色');
    if (dto.roleCode === PlatformRole.SUPER_ADMIN) throw new BadRequestException('不允许创建 super_admin 账号');
    // 归一化城市列表（去空、去重）
    const cityIds = [...new Set((dto.cityIds ?? []).map((id) => String(id).trim()).filter(Boolean))];
    if (dto.roleCode === PlatformRole.CITY_USER && cityIds.length === 0) throw new BadRequestException('地市用户至少绑定一个地市');
    const existing = await this.userRepo.findOneBy({ username: dto.username });
    if (existing) throw new BadRequestException('账号已存在');

    // 校验所选城市都存在
    if (cityIds.length && (await this.cityRepo.countBy({ id: In(cityIds) })) !== new Set(cityIds).size) {
      throw new BadRequestException('存在不存在的地市');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const user = await this.userRepo.save({
      id: randomUUID(),
      username: dto.username,
      passwordHash,
      name: dto.name,
      roleCode: dto.roleCode,
      cityId: dto.roleCode === PlatformRole.CITY_USER ? (cityIds[0] ?? null) : null,
      status: 'enabled',
      authVersion: 1,
      sensitiveOrderScope: dto.sensitiveOrderScope ?? 'masked',
      mustChangePassword: true,
    });
    await this.userRoleRepo.save({ id: randomUUID(), userId: user.id, roleCode: dto.roleCode, isPrimary: true });
    if (dto.roleCode === PlatformRole.CITY_USER && cityIds.length) {
      // 多城市：每个城市各写一条 allow grant；user.cityId 取第一个作为主城市（向前兼容）
      for (const cityId of cityIds) {
        await this.scopeGrantRepo.save({ id: randomUUID(), userId: user.id, scopeType: 'city', targetId: cityId, effect: 'allow' });
      }
    } else if (dto.roleCode === PlatformRole.ADMIN) {
      await this.scopeGrantRepo.save({ id: randomUUID(), userId: user.id, scopeType: 'all', targetId: null, effect: 'allow' });
    }
    await this.recordOp(operatorId, 'user.create', 'user', user.id);
    return user;
  }

  /** 停用：立即禁止登录并使旧会话失效（authVersion+1） */
  async setUserStatus(operatorId: string, userId: string, status: 'enabled' | 'disabled'): Promise<PlatformUserEntity> {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('账号不存在');
    if (user.roleCode === PlatformRole.SUPER_ADMIN) throw new BadRequestException('不允许停用 super_admin');
    user.status = status;
    user.authVersion += 1; // 停用/启用都使旧会话失效
    await this.userRepo.save(user);
    await this.recordOp(operatorId, status === 'disabled' ? 'user.disable' : 'user.enable', 'user', userId);
    return user;
  }

  /** 重置密码：旧会话失效（authVersion+1） */
  async resetPassword(operatorId: string, userId: string, newPassword: string): Promise<void> {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('账号不存在');
    if (user.roleCode === PlatformRole.SUPER_ADMIN) throw new BadRequestException('不允许重置 super_admin 密码');
    user.passwordHash = await bcrypt.hash(newPassword, 10);
    user.authVersion += 1;
    user.mustChangePassword = true;
    await this.userRepo.save(user);
    await this.recordOp(operatorId, 'user.reset_password', 'user', userId);
  }

  /** 用户最终权限（角色默认 + 账号例外；super_admin 通配） */
  async getUserEffectivePermissions(userId: string): Promise<{ roleCode: string; base: string[]; overrides: UserPermissionOverrideEntity[]; effective: string[] }> {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('账号不存在');
    if (user.roleCode === PlatformRole.SUPER_ADMIN) {
      return { roleCode: user.roleCode, base: ['*'], overrides: [], effective: ['*'] };
    }
    const role = await this.roleRepo.findOneBy({ code: user.roleCode });
    const bindings = role ? await this.rolePermissionRepo.findBy({ roleId: role.id }) : [];
    const base = bindings.map((b) => b.permissionCode);
    const overrides = await this.overrideRepo.findBy({ userId });
    const effective = new Set(base);
    for (const override of overrides) {
      if (override.effect === 'allow') effective.add(override.permissionCode);
      else effective.delete(override.permissionCode);
    }
    return { roleCode: user.roleCode, base, overrides, effective: Array.from(effective) };
  }

  /** 全量替换账号例外权限 */
  async setPermissionOverrides(operatorId: string, userId: string, inputs: PermissionOverrideInput[]): Promise<void> {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('账号不存在');
    if (user.roleCode === PlatformRole.SUPER_ADMIN) throw new BadRequestException('不允许调整 super_admin 权限');
    await this.overrideRepo.delete({ userId });
    for (const input of inputs) {
      await this.overrideRepo.save({
        id: randomUUID(),
        userId,
        permissionCode: input.permissionCode,
        effect: input.effect,
      });
    }
    await this.recordOp(operatorId, 'user.permission_overrides', 'user', userId);
  }

  /** 全量替换数据范围 */
  async setDataScopes(operatorId: string, userId: string, inputs: DataScopeInput[]): Promise<void> {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('账号不存在');
    if (user.roleCode === PlatformRole.SUPER_ADMIN) throw new BadRequestException('不允许调整 super_admin 数据范围');
    await this.dataScopeRepo.delete({ userId });
    await this.scopeGrantRepo.delete({ userId });
    for (const input of inputs) {
      await this.dataScopeRepo.save({
        id: randomUUID(),
        userId,
        provinceId: input.provinceId ?? null,
        cityId: input.cityId ?? null,
        scopeType: input.provinceId === null && input.cityId === null ? 'all' : (input.cityId ? 'city' : 'province'),
      });
      await this.scopeGrantRepo.save({ id: randomUUID(), userId, scopeType: input.provinceId === null && input.cityId === null ? 'all' : (input.cityId ? 'city' : 'province'), targetId: input.cityId ?? input.provinceId ?? null, effect: 'allow' });
    }
    user.authVersion += 1;
    await this.userRepo.save(user);
    await this.recordOp(operatorId, 'user.data_scopes', 'user', userId);
  }

  async getUserAccess(userId: string): Promise<{ roles: UserRoleEntity[]; grants: UserScopeGrantEntity[] }> {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('账号不存在');
    return { roles: await this.userRoleRepo.findBy({ userId }), grants: await this.scopeGrantRepo.findBy({ userId }) };
  }

  async setUserAccess(operatorId: string, userId: string, roles: string[], grants: ScopeGrantInput[]): Promise<void> {
    const user = await this.userRepo.findOneBy({ id: userId });
    if (!user) throw new NotFoundException('账号不存在');
    const normalizedRoles = [...new Set((roles ?? []).map((role) => String(role).trim()).filter((role) => PLATFORM_ROLES.includes(role as PlatformRole)))];
    if (!normalizedRoles.length || normalizedRoles.includes(PlatformRole.SUPER_ADMIN)) throw new BadRequestException('角色配置无效，super_admin 只能保留系统内置账号');
    const roleRows = await this.roleRepo.findBy({ code: In(normalizedRoles) });
    if (roleRows.length !== normalizedRoles.length) throw new BadRequestException('存在不存在的角色');
    const normalizedGrants = (grants ?? []).map((grant) => ({
      scopeType: grant.scopeType,
      targetId: grant.scopeType === 'all' ? null : String(grant.targetId ?? '').trim() || null,
      effect: grant.effect ?? 'allow',
    }));
    if (normalizedGrants.some((grant) => !['all', 'province', 'city', 'contract'].includes(grant.scopeType) || grant.scopeType !== 'all' && !grant.targetId)) {
      throw new BadRequestException('数据范围配置不完整');
    }
    const provinceIds = normalizedGrants.filter((grant) => grant.scopeType === 'province' && grant.targetId).map((grant) => grant.targetId as string);
    const cityIds = normalizedGrants.filter((grant) => grant.scopeType === 'city' && grant.targetId).map((grant) => grant.targetId as string);
    const contractIds = normalizedGrants.filter((grant) => grant.scopeType === 'contract' && grant.targetId).map((grant) => grant.targetId as string);
    if (provinceIds.length && (await this.provinceRepo.countBy({ id: In(provinceIds) })) !== new Set(provinceIds).size) throw new BadRequestException('存在不存在的省份范围');
    if (cityIds.length && (await this.cityRepo.countBy({ id: In(cityIds) })) !== new Set(cityIds).size) throw new BadRequestException('存在不存在的地市范围');
    if (contractIds.length) {
      const rows = await this.dataSource.query('SELECT id FROM biz_contracts WHERE id IN (?)', [contractIds]) as Array<{ id: string }>;
      if (rows.length !== new Set(contractIds).size) throw new BadRequestException('存在不存在的合同范围');
    }
    await this.dataSource.transaction(async (manager) => {
      await manager.delete(UserRoleEntity, { userId });
      await manager.delete(UserScopeGrantEntity, { userId });
      await manager.save(UserRoleEntity, normalizedRoles.map((roleCode, index) => ({ id: randomUUID(), userId, roleCode, isPrimary: index === 0 })));
      await manager.save(UserScopeGrantEntity, normalizedGrants.map((grant) => ({ id: randomUUID(), userId, scopeType: grant.scopeType, targetId: grant.targetId, effect: grant.effect })));
      user.roleCode = normalizedRoles[0];
      user.cityId = normalizedGrants.find((grant) => grant.scopeType === 'city' && grant.effect === 'allow')?.targetId ?? null;
      user.authVersion += 1;
      await manager.save(PlatformUserEntity, user);
    });
    await this.recordOp(operatorId, 'user.access.update', 'user', userId);
  }

  // ================= 字典 =================

  async listRoles(): Promise<RoleEntity[]> {
    return this.roleRepo.find({ order: { code: 'ASC' } });
  }

  async listModules(): Promise<ModuleEntity[]> {
    return this.moduleRepo.find({ order: { level: 'ASC', sortOrder: 'ASC' } });
  }

  async listPermissions(): Promise<PermissionEntity[]> {
    return this.permissionRepo.find({ order: { code: 'ASC' } });
  }

  async listProvinces(): Promise<ProvinceEntity[]> {
    return this.provinceRepo.find({ order: { code: 'ASC' } });
  }

  async listCities(provinceId?: string): Promise<CityEntity[]> {
    return this.cityRepo.find({
      where: provinceId ? { provinceId } : {},
      order: { code: 'ASC' },
    });
  }

  async createProvince(operatorId: string, input: ProvinceInput): Promise<ProvinceEntity> {
    const code = input.code.trim(); const name = input.name.trim();
    if (!code || !name) throw new BadRequestException('省份编码和名称不能为空');
    if (await this.provinceRepo.findOne({ where: [{ code }, { name }] })) throw new BadRequestException('省份编码或名称已存在');
    const item = await this.provinceRepo.save({ id: randomUUID(), code, name, status: 'active' });
    await this.recordOp(operatorId, 'master_data.province.create', 'province', item.id); return item;
  }

  async updateProvince(operatorId: string, id: string, input: Partial<ProvinceInput>): Promise<ProvinceEntity> {
    const item = await this.provinceRepo.findOneBy({ id }); if (!item) throw new NotFoundException('省份不存在');
    const code = input.code?.trim(); const name = input.name?.trim();
    if (code) item.code = code; if (name) item.name = name;
    const duplicate = await this.provinceRepo.findOne({ where: [{ code: item.code }, { name: item.name }] }); if (duplicate && duplicate.id !== id) throw new BadRequestException('省份编码或名称已存在');
    const saved = await this.provinceRepo.save(item); await this.recordOp(operatorId, 'master_data.province.update', 'province', id); return saved;
  }

  async deleteProvince(operatorId: string, id: string): Promise<void> {
    const item = await this.provinceRepo.findOneBy({ id }); if (!item) throw new NotFoundException('省份不存在');
    if (await this.cityRepo.countBy({ provinceId: id })) throw new BadRequestException('该省份下仍有经营单位，不能删除');
    await this.provinceRepo.remove(item); await this.recordOp(operatorId, 'master_data.province.delete', 'province', id);
  }

  async createCity(operatorId: string, input: CityInput): Promise<CityEntity> {
    const province = await this.provinceRepo.findOneBy({ id: input.provinceId }); if (!province) throw new BadRequestException('所属省份不存在');
    const code = input.code.trim(); const name = input.name.trim(); if (!code || !name) throw new BadRequestException('经营单位编码和名称不能为空');
    if (await this.cityRepo.findOne({ where: [{ code }, { provinceId: input.provinceId, name }] })) throw new BadRequestException('经营单位编码或名称已存在');
    const item = await this.cityRepo.save({ id: randomUUID(), provinceId: input.provinceId, code, name, unitType: input.unitType ?? 'city', status: 'active' });
    await this.recordOp(operatorId, 'master_data.city.create', 'city', item.id); return item;
  }

  async updateCity(operatorId: string, id: string, input: Partial<CityInput>): Promise<CityEntity> {
    const item = await this.cityRepo.findOneBy({ id }); if (!item) throw new NotFoundException('经营单位不存在');
    if (input.provinceId && !(await this.provinceRepo.findOneBy({ id: input.provinceId }))) throw new BadRequestException('所属省份不存在');
    if (input.provinceId) item.provinceId = input.provinceId; if (input.code?.trim()) item.code = input.code.trim(); if (input.name?.trim()) item.name = input.name.trim(); if (input.unitType) item.unitType = input.unitType;
    const duplicate = await this.cityRepo.findOne({ where: [{ code: item.code }, { provinceId: item.provinceId, name: item.name }] }); if (duplicate && duplicate.id !== id) throw new BadRequestException('经营单位编码或名称已存在');
    const saved = await this.cityRepo.save(item); await this.recordOp(operatorId, 'master_data.city.update', 'city', id); return saved;
  }

  async deleteCity(operatorId: string, id: string): Promise<void> {
    const item = await this.cityRepo.findOneBy({ id }); if (!item) throw new NotFoundException('经营单位不存在');
    if (await this.userRepo.countBy({ cityId: id })) throw new BadRequestException('该经营单位仍绑定账号，不能删除');
    await this.cityRepo.remove(item); await this.recordOp(operatorId, 'master_data.city.delete', 'city', id);
  }
}
