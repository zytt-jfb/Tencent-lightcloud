import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import {
  ChangeOwnPasswordRequest,
  CreateManagedUserRequest,
  CreateManagedUserResponse,
  ResetManagedUserPasswordResponse,
  Role,
  UpdateManagedUserRoleRequest,
  UserStatus,
} from '@biz-reporting/shared-types';
import { UserEntity } from './user.entity';
import { CityEntity } from '../cities/city.entity';
import { OperationLogEntity } from '../common/entities/operation-log.entity';

export interface SecurityActor {
  userId: number;
  role: Role | string;
  cityId: number | null;
}

@Injectable()
export class AccountSecurityService {
  constructor(
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
    @InjectRepository(CityEntity) private readonly cities: Repository<CityEntity>,
    @InjectRepository(OperationLogEntity) private readonly logs: Repository<OperationLogEntity>,
  ) {}

  async createAccount(dto: CreateManagedUserRequest, actor: SecurityActor): Promise<CreateManagedUserResponse> {
    this.assertRoot(actor);
    if (dto.role === Role.ROOT_ADMIN) throw new BadRequestException('根账号只能通过显式提升工具建立');
    this.assertManagedRole(dto.role);
    const username = this.normalizeUsername(dto.username);
    if (await this.users.findOne({ where: { username } })) throw new ConflictException('用户名已被使用');
    const cityId = await this.resolveCity(dto.role, dto.cityId);
    const temporaryPassword = this.generateTemporaryPassword();
    const user = await this.users.save(this.users.create({
      username,
      name: this.normalizeName(dto.name),
      role: dto.role,
      cityId,
      openid: null,
      passwordHash: await bcrypt.hash(temporaryPassword, 12),
      status: UserStatus.ENABLED,
      authVersion: 1,
      mustChangePassword: true,
    }));
    await this.audit(actor, 'account_create', user.id, null, { role: user.role, cityId: user.cityId, username: user.username });
    return { user: this.toListItem(user), temporaryPassword };
  }

  async resetPassword(userId: number, actor: SecurityActor): Promise<ResetManagedUserPasswordResponse> {
    this.assertRoot(actor);
    const user = await this.findUserForSecurity(userId);
    const temporaryPassword = this.generateTemporaryPassword();
    await this.users.update(user.id, {
      passwordHash: await bcrypt.hash(temporaryPassword, 12),
      mustChangePassword: true,
      authVersion: user.authVersion + 1,
    });
    await this.audit(actor, 'account_password_reset', user.id, { authVersion: user.authVersion }, { authVersion: user.authVersion + 1, mustChangePassword: true });
    return { userId: user.id, temporaryPassword };
  }

  async updateStatus(userId: number, status: UserStatus, actor: SecurityActor) {
    this.assertRoot(actor);
    const user = await this.findUserForSecurity(userId);
    if (user.role === Role.ROOT_ADMIN && status !== UserStatus.ENABLED) throw new ForbiddenException('根账号不可禁用');
    await this.users.update(user.id, { status, authVersion: user.authVersion + 1 });
    await this.audit(actor, 'account_status_change', user.id, { status: user.status }, { status });
    return this.toListItem((await this.findUserForSecurity(user.id)));
  }

  async updateRole(userId: number, dto: UpdateManagedUserRoleRequest, actor: SecurityActor) {
    this.assertRoot(actor);
    const user = await this.findUserForSecurity(userId);
    if (user.role === Role.ROOT_ADMIN) throw new ForbiddenException('根账号不可降级或变更范围');
    if (dto.role === Role.ROOT_ADMIN) throw new BadRequestException('根账号只能通过显式提升工具建立');
    this.assertManagedRole(dto.role);
    const cityId = await this.resolveCity(dto.role, dto.cityId);
    await this.users.update(user.id, { role: dto.role, cityId, authVersion: user.authVersion + 1 });
    await this.audit(actor, 'account_role_change', user.id, { role: user.role, cityId: user.cityId }, { role: dto.role, cityId });
    return this.toListItem((await this.findUserForSecurity(user.id)));
  }

  async updateCity(userId: number, cityId: number, actor: SecurityActor) {
    this.assertRoot(actor);
    const user = await this.findUserForSecurity(userId);
    if (user.role === Role.ROOT_ADMIN) throw new ForbiddenException('根账号不可绑定地市');
    if (user.role !== Role.CITY_USER) throw new BadRequestException('只有地市用户可以绑定地市');
    const resolvedCityId = await this.resolveCity(Role.CITY_USER, cityId);
    await this.users.update(user.id, { cityId: resolvedCityId, authVersion: user.authVersion + 1 });
    await this.audit(actor, 'account_city_change', user.id, { cityId: user.cityId }, { cityId: resolvedCityId });
    return this.toListItem((await this.findUserForSecurity(user.id)));
  }

  async changeOwnPassword(actor: SecurityActor, dto: ChangeOwnPasswordRequest): Promise<void> {
    if (dto.newPassword !== dto.confirmPassword) throw new BadRequestException('两次输入的新密码不一致');
    this.validatePassword(dto.newPassword);
    const user = await this.findUserForSecurity(actor.userId);
    if (!user.passwordHash) throw new BadRequestException('当前账号尚未配置密码，请联系 root_admin 获取临时密码');
    if (!await bcrypt.compare(dto.currentPassword, user.passwordHash)) throw new UnauthorizedException('原密码错误');
    if (await bcrypt.compare(dto.newPassword, user.passwordHash)) throw new BadRequestException('新密码不能与原密码相同');
    await this.users.update(user.id, {
      passwordHash: await bcrypt.hash(dto.newPassword, 12),
      mustChangePassword: false,
      authVersion: user.authVersion + 1,
    });
    await this.audit(actor, 'own_password_change', user.id, { authVersion: user.authVersion }, { authVersion: user.authVersion + 1, mustChangePassword: false });
  }

  async auditLogout(actor: SecurityActor): Promise<void> {
    await this.audit(actor, 'logout', actor.userId, null, { sessionEnded: true });
  }

  async rootReadiness(): Promise<{ count: number; ready: boolean }> {
    const count = await this.users.count({ where: { role: Role.ROOT_ADMIN } });
    return { count, ready: count === 1 };
  }

  private async findUserForSecurity(id: number): Promise<UserEntity> {
    const user = await this.users.findOne({
      where: { id },
      select: ['id', 'role', 'name', 'cityId', 'openid', 'username', 'passwordHash', 'status', 'authVersion', 'mustChangePassword', 'registerAt', 'lastLoginAt'],
    });
    if (!user) throw new NotFoundException('用户不存在');
    return user;
  }

  private assertRoot(actor: SecurityActor): void {
    if (actor.role !== Role.ROOT_ADMIN) throw new ForbiddenException('仅 root_admin 可执行此操作');
  }

  private assertManagedRole(role: Role): void {
    if (![Role.CONTRACT_MANAGER, Role.SYSTEM_ADMIN, Role.CITY_USER].includes(role)) throw new BadRequestException('目标角色不合法');
  }

  private async resolveCity(role: Role, value: number | null | undefined): Promise<number | null> {
    if (role !== Role.CITY_USER) return null;
    const cityId = Number(value);
    if (!Number.isInteger(cityId) || cityId <= 0) throw new BadRequestException('地市用户必须绑定有效地市');
    if (!await this.cities.findOne({ where: { id: cityId, isDeleted: 0 } })) throw new BadRequestException('目标地市不存在');
    return cityId;
  }

  private normalizeUsername(value: string): string {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || normalized.length > 100) throw new BadRequestException('用户名长度不合法');
    return normalized;
  }

  private normalizeName(value: string): string {
    const normalized = typeof value === 'string' ? value.trim() : '';
    if (!normalized || normalized.length > 100) throw new BadRequestException('姓名长度不合法');
    return normalized;
  }

  private validatePassword(value: string): void {
    if (typeof value !== 'string' || value.length < 8 || value.length > 128) throw new BadRequestException('密码长度必须为 8-128 位');
  }

  private generateTemporaryPassword(): string {
    return `${randomBytes(18).toString('base64url')}!7a`;
  }

  private toListItem(user: UserEntity) {
    return {
      id: user.id,
      role: user.role,
      name: user.name,
      cityId: user.cityId,
      cityName: null,
      status: user.status,
      registerAt: user.registerAt?.toISOString?.() ?? new Date().toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString?.() ?? null,
      mustChangePassword: Boolean(user.mustChangePassword),
    };
  }

  private async audit(actor: SecurityActor, actionType: string, targetId: number, beforeDataJson: unknown, afterDataJson: unknown) {
    await this.logs.save(this.logs.create({
      operatorUserId: actor.userId,
      operatorCityId: actor.cityId,
      actionType,
      targetType: 'user',
      targetId: String(targetId),
      summaryText: actionType,
      beforeDataJson,
      afterDataJson,
      resultStatus: 'success',
    }));
  }
}
