import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserEntity } from './user.entity';
import { CityEntity } from '../cities/city.entity';
import { OperationLogEntity } from '../common/entities/operation-log.entity';
import { Role, UserStatus } from '@biz-reporting/shared-types';
import type {
  UserListItem,
  UserListResponse,
  PaginationParams,
} from '@biz-reporting/shared-types';

export interface CreateCityUserInput {
  name: string;
  openid: string | null;
  cityId: number;
  username?: string | null;
  passwordHash?: string | null;
}

export interface MigrateUserRoleInput {
  targetRole: Role;
  cityId?: number | null;
}

export interface UserWithCityName extends Omit<UserEntity, 'passwordHash'> {
  cityName: string | null;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(CityEntity)
    private readonly cityRepository: Repository<CityEntity>,
    @InjectRepository(OperationLogEntity)
    private readonly operationLogRepo: Repository<OperationLogEntity>,
  ) {}

  async findById(id: number): Promise<UserWithCityName | null> {
    const user = await this.userRepository.findOne({ where: { id } });
    if (!user) return null;

    let cityName: string | null = null;
    if (user.cityId) {
      const city = await this.cityRepository.findOne({
        where: { id: user.cityId },
        select: ['name'],
      });
      if (city) cityName = city.name;
    }

    const { passwordHash: _pwd, ...rest } = user;
    return { ...rest, cityName };
  }

  async findByUsername(username: string): Promise<UserEntity | null> {
    return this.withTransientDbRetry(
      () => this.userRepository.findOne({
        where: { username },
        select: ['id', 'role', 'name', 'cityId', 'username', 'passwordHash', 'status', 'authVersion', 'mustChangePassword'],
      }),
      `find user by username: ${username}`,
    );
  }

  async findCityUsersByName(name: string): Promise<UserEntity[]> {
    return this.userRepository.find({
      where: { role: Role.CITY_USER, name },
      select: ['id', 'role', 'name', 'cityId', 'openid', 'username', 'passwordHash', 'status'],
      order: { id: 'ASC' },
    });
  }

  async setWebCredentials(
    userId: number,
    username: string,
    passwordHash: string,
  ): Promise<UserEntity> {
    const user = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'role', 'name', 'cityId', 'openid', 'username', 'passwordHash', 'status'],
    });
    if (!user) throw new NotFoundException('User not found');

    const beforeDataJson = {
      username: user.username,
      passwordConfigured: Boolean(user.passwordHash),
    };
    await this.userRepository.update(userId, { username, passwordHash });
    await this.operationLogRepo.save(
      this.operationLogRepo.create({
        operatorUserId: userId,
        operatorCityId: user.cityId,
        actionType: 'city_web_credentials_register',
        targetType: 'user',
        targetId: String(userId),
        summaryText: 'City user Web credentials registered',
        beforeDataJson,
        afterDataJson: { username, passwordConfigured: true },
        resultStatus: 'success',
      }),
    );

    const updated = await this.userRepository.findOne({
      where: { id: userId },
      select: ['id', 'role', 'name', 'cityId', 'openid', 'username', 'passwordHash', 'status'],
    });
    if (!updated) throw new NotFoundException('User not found after credential update');
    return updated;
  }

  async createCityUser(input: CreateCityUserInput): Promise<UserEntity> {
    const city = await this.cityRepository.findOne({
      where: { id: input.cityId, isDeleted: 0 },
    });
    if (!city) throw new BadRequestException('Target city not found');

    const user = this.userRepository.create({
      role: Role.CITY_USER,
      name: input.name,
      openid: input.openid,
      username: input.username ?? null,
      passwordHash: input.passwordHash ?? null,
      cityId: input.cityId,
      status: UserStatus.ENABLED,
    });

    return this.userRepository.save(user);
  }
  async migrateLegacyRole(
    userId: number,
    input: MigrateUserRoleInput,
    operatorUserId: number,
  ): Promise<UserListItem> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const legacyRole = String(user.role).toLowerCase();
    if (legacyRole !== 'reviewer' && legacyRole !== 'auditor') {
      throw new BadRequestException('Only reviewer or auditor accounts can be migrated');
    }
    if (input.targetRole !== Role.SYSTEM_ADMIN && input.targetRole !== Role.CITY_USER) {
      throw new BadRequestException('Target role must be system_admin or city_user');
    }

    let cityId: number | null = null;
    if (input.targetRole === Role.CITY_USER) {
      cityId = input.cityId ?? user.cityId;
      if (cityId === null) {
        throw new BadRequestException('A city is required when migrating to city_user');
      }
      const city = await this.cityRepository.findOne({ where: { id: cityId } });
      if (!city) throw new BadRequestException('Target city not found');
    }

    const beforeRole = user.role;
    const beforeCityId = user.cityId;
    await this.userRepository.update(userId, {
      role: input.targetRole,
      cityId,
    });

    await this.operationLogRepo.save(
      this.operationLogRepo.create({
        operatorUserId,
        operatorCityId: null,
        actionType: 'user_role_migration',
        targetType: 'user',
        targetId: String(userId),
        summaryText: 'Legacy user role migrated',
        beforeDataJson: { role: beforeRole, cityId: beforeCityId },
        afterDataJson: { role: input.targetRole, cityId },
        resultStatus: 'success',
      }),
    );

    const updated = await this.findById(userId);
    if (!updated) throw new NotFoundException('Migrated user not found');
    return {
      id: updated.id,
      role: updated.role,
      name: updated.name,
      cityId: updated.cityId,
      cityName: updated.cityName,
      status: updated.status,
      registerAt: updated.registerAt.toISOString(),
      lastLoginAt: updated.lastLoginAt?.toISOString() ?? null,
      mustChangePassword: Boolean(updated.mustChangePassword),
    };
  }
  async updateLastLogin(userId: number): Promise<void> {
    await this.withTransientDbRetry(
      () => this.userRepository.update(userId, {
        lastLoginAt: new Date(),
      }),
      `update last login: ${userId}`,
    );
  }

  async list(params: PaginationParams): Promise<UserListResponse> {
    const page = params.page || 1;
    const pageSize = params.pageSize || 20;

    const [users, total] = await this.userRepository.findAndCount({
      skip: (page - 1) * pageSize,
      take: pageSize,
      order: { id: 'ASC' },
    });

    const items: UserListItem[] = await Promise.all(
      users.map(async (u) => {
        let cityName: string | null = null;
        if (u.cityId) {
          const city = await this.cityRepository.findOne({
            where: { id: u.cityId },
            select: ['name'],
          });
          cityName = city?.name ?? null;
        }
        return {
          id: u.id,
          role: u.role,
          name: u.name,
          cityId: u.cityId,
          cityName,
          status: u.status,
          registerAt: u.registerAt.toISOString(),
          lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
          mustChangePassword: Boolean(u.mustChangePassword),
        };
      }),
    );

    return { items, total, page, pageSize };
  }

  async updateStatus(
    userId: number,
    status: UserStatus,
  ): Promise<UserListItem> {
    await this.userRepository.update(userId, { status });
    const user = await this.findById(userId);
    if (!user) throw new NotFoundException(`用户 #${userId} 不存在`);
    return {
      id: user.id,
      role: user.role,
      name: user.name,
      cityId: user.cityId,
      cityName: user.cityName,
      status: user.status,
      registerAt: user.registerAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      mustChangePassword: Boolean(user.mustChangePassword),
    };
  }

  async rebindCity(userId: number, cityId: number, operatorUserId: number): Promise<UserListItem> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException(`用户 #${userId} 不存在`);
    if (user.role !== Role.CITY_USER) {
      throw new BadRequestException('仅城市用户可重新绑定城市');
    }

    const oldCityId = user.cityId;
    let oldCityName: string | null = null;
    if (oldCityId) {
      const oldCity = await this.cityRepository.findOne({ where: { id: oldCityId }, select: ['name'] });
      oldCityName = oldCity?.name ?? null;
    }

    await this.userRepository.update(userId, { cityId });
    const updated = await this.findById(userId);
    if (!updated) throw new NotFoundException(`用户 #${userId} 不存在`);

    await this.operationLogRepo.save(
      this.operationLogRepo.create({
        operatorUserId,
        actionType: 'user_rebind_city',
        targetType: 'user',
        targetId: String(userId),
        summaryText: `管理员将用户 ${user.name} 从城市 ${oldCityName ?? oldCityId ?? '无'} 改绑至城市 ${updated.cityName}`,
        beforeDataJson: { cityId: oldCityId, cityName: oldCityName },
        afterDataJson: { cityId: updated.cityId, cityName: updated.cityName },
        resultStatus: 'success',
      }),
    );

    return {
      id: updated.id,
      role: updated.role,
      name: updated.name,
      cityId: updated.cityId,
      cityName: updated.cityName,
      status: updated.status,
      registerAt: updated.registerAt.toISOString(),
      lastLoginAt: updated.lastLoginAt?.toISOString() ?? null,
      mustChangePassword: Boolean(updated.mustChangePassword),
    };
  }

  private async withTransientDbRetry<T>(
    operation: () => Promise<T>,
    context: string,
    maxRetries = 1,
  ): Promise<T> {
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (attempt >= maxRetries || !this.isTransientDbError(error)) {
          throw error;
        }

        const message = this.getErrorMessage(error);
        console.warn(`[UsersService] retrying ${context} after transient DB error: ${message}`);
        await this.delay(150 * (attempt + 1));
      }
    }

    throw new Error(`${context} failed after retry`);
  }

  private isTransientDbError(error: unknown): boolean {
    const message = this.getErrorMessage(error).toLowerCase();
    return (
      message.includes('econnreset') ||
      message.includes('malformed communication packet') ||
      message.includes('protocol') ||
      message.includes('connection lost') ||
      message.includes('read eof') ||
      message.includes('deadlock found') ||
      message.includes('lock wait timeout exceeded')
    );
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    if (typeof error === 'object' && error !== null) {
      const message = (error as { message?: unknown }).message;
      if (typeof message === 'string') {
        return message;
      }
    }

    return String(error);
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }
}
