import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { UserScopeGrantEntity } from './user-scope-grant.entity';
import { CityEntity } from '../main-data/city.entity';

export type ScopeType = 'all' | 'province' | 'city' | 'contract' | 'mixed' | 'none';

export interface AccessScopeSnapshot {
  allowAll: boolean;
  provinceIds: string[];
  cityIds: string[];
  contractIds: string[];
  deniedProvinceIds: string[];
  deniedCityIds: string[];
  deniedContractIds: string[];
  scopeType: ScopeType;
  /** Backward compatible single-city projection for older business services. */
  cityId: string | null;
}

/**
 * Single source of truth for object scope authorization. Role grants are
 * intentionally not interpreted here; this service only resolves the explicit
 * allow/deny object grants attached to an account.
 */
@Injectable()
export class AccessScopeService {
  constructor(
    @InjectRepository(UserScopeGrantEntity)
    private readonly grantRepo: Repository<UserScopeGrantEntity>,
    @InjectRepository(CityEntity)
    private readonly cityRepo: Repository<CityEntity>,
  ) {}

  async resolve(userId: string): Promise<AccessScopeSnapshot> {
    const grants = await this.grantRepo.findBy({ userId });
    const allowAll = grants.some((grant) => grant.scopeType === 'all' && grant.effect === 'allow');
    const deniedAll = grants.some((grant) => grant.scopeType === 'all' && grant.effect === 'deny');
    const collect = (scopeType: 'province' | 'city' | 'contract', effect: 'allow' | 'deny') => [...new Set(
      grants.filter((grant) => grant.scopeType === scopeType && grant.effect === effect && Boolean(grant.targetId))
        .map((grant) => grant.targetId as string),
    )];
    const deniedProvinceIds = collect('province', 'deny');
    const deniedCityIds = collect('city', 'deny');
    const deniedContractIds = collect('contract', 'deny');
    const provinceIds = collect('province', 'allow').filter((id) => !deniedProvinceIds.includes(id));
    const cityIds = collect('city', 'allow').filter((id) => !deniedCityIds.includes(id));
    const contractIds = collect('contract', 'allow').filter((id) => !deniedContractIds.includes(id));
    const effectiveAll = allowAll && !deniedAll;
    const types = [effectiveAll ? 'all' : '', provinceIds.length ? 'province' : '', cityIds.length ? 'city' : '', contractIds.length ? 'contract' : ''].filter(Boolean);
    const scopeType: ScopeType = effectiveAll ? 'all' : types.length === 0 ? 'none' : types.length === 1 ? types[0] as ScopeType : 'mixed';
    return {
      allowAll: effectiveAll,
      provinceIds,
      cityIds,
      contractIds,
      deniedProvinceIds,
      deniedCityIds,
      deniedContractIds,
      scopeType,
      cityId: cityIds.length === 1 ? cityIds[0] : null,
    };
  }

  async canAccessProvince(scope: AccessScopeSnapshot, provinceId: string): Promise<boolean> {
    if (!provinceId || scope.deniedProvinceIds.includes(provinceId)) return false;
    if (scope.allowAll) return true;
    return scope.provinceIds.includes(provinceId);
  }

  async canAccessCity(scope: AccessScopeSnapshot, cityId: string): Promise<boolean> {
    if (!cityId || scope.deniedCityIds.includes(cityId)) return false;
    if (scope.allowAll || scope.cityIds.includes(cityId)) return true;
    const city = await this.cityRepo.findOneBy({ id: cityId });
    return Boolean(city && await this.canAccessProvince(scope, city.provinceId));
  }

  canAccessContract(scope: AccessScopeSnapshot, contractId: string): boolean {
    if (!contractId || scope.deniedContractIds.includes(contractId)) return false;
    return scope.allowAll || scope.contractIds.includes(contractId);
  }

  async assertProvince(scope: AccessScopeSnapshot, provinceId?: string | null): Promise<void> {
    if (!provinceId || await this.canAccessProvince(scope, provinceId)) return;
    throw new ForbiddenException('数据范围不足');
  }

  async assertCity(scope: AccessScopeSnapshot, cityId?: string | null): Promise<void> {
    if (!cityId || await this.canAccessCity(scope, cityId)) return;
    throw new ForbiddenException('数据范围不足');
  }

  assertContract(scope: AccessScopeSnapshot, contractId: string): void {
    if (this.canAccessContract(scope, contractId)) return;
    throw new ForbiddenException('数据范围不足');
  }

  async expandProvinceCities(scope: AccessScopeSnapshot): Promise<string[] | null> {
    if (scope.allowAll) return null;
    const ids = new Set(scope.cityIds);
    if (scope.provinceIds.length) {
      const cities = await this.cityRepo.find({ where: { provinceId: In(scope.provinceIds) } });
      for (const city of cities) if (!scope.deniedCityIds.includes(city.id)) ids.add(city.id);
    }
    return [...ids];
  }
}
