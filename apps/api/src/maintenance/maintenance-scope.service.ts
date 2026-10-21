import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { SelectQueryBuilder } from 'typeorm';
import { CityEntity } from '../main-data/city.entity';
import { ProvinceEntity } from '../main-data/province.entity';
import { AccessScopeService, type AccessScopeSnapshot } from '../rbac/access-scope.service';
import { BizAuthContext } from '../rbac/rbac.service';
import { cityAliases } from '../common/org-name';

/**
 * 维护数据的数据范围解析
 *
 * 为什么需要这一层：维护三张表的 org_province / org_city 是**中文文本**，
 * 而账号数据范围里存的是省份 / 地市 **UUID**。原代码没有做这层转换，
 * 导致地市账号看到的是全省数据（或按错误条件查不到）。
 *
 * 口径：
 *  - 超管 / allowAll → 不过滤
 *  - 地市或省份范围 → 展开成该范围内的地市**名称**（含去掉「市」后缀的别名，
 *    因为维护表里存的是「东营市」、绩效表里存的是「东营」）
 *  - 无任何范围（none / 仅合同）→ 恒 false，返回空集
 */
export interface MaintenanceOrgScope {
  allowAll: boolean;
  cityNames: string[];
}

@Injectable()
export class MaintenanceScopeService {
  constructor(
    private readonly accessScope: AccessScopeService,
    @InjectRepository(CityEntity) private readonly cityRepo: Repository<CityEntity>,
    @InjectRepository(ProvinceEntity) private readonly provinceRepo: Repository<ProvinceEntity>,
  ) {}

  async resolve(auth: BizAuthContext): Promise<MaintenanceOrgScope> {
    const scope = auth.dataScope;
    if (auth.isSuperAdmin || scope.allowAll || scope.scopeType === 'all') return { allowAll: true, cityNames: [] };

    const cityIds = await this.accessScope.expandProvinceCities(scope as unknown as AccessScopeSnapshot);
    if (cityIds === null) return { allowAll: true, cityNames: [] };

    const ids = new Set(cityIds);
    if (scope.cityId) ids.add(scope.cityId);
    if (!ids.size) return { allowAll: false, cityNames: [] };

    const cities = await this.cityRepo.findBy({ id: In([...ids]) });
    const names = new Set<string>();
    for (const city of cities) for (const alias of cityAliases(city.name)) names.add(alias);

    // 兜底：地市字典里查不到（例如账号绑的地市已被删）时，用省份名称匹配，避免整页空白；
    // 仍查不到就返回空集，宁可看不到也不能越权看全省。
    if (!names.size) {
      const provinceIds = [...new Set(cities.map((city) => city.provinceId).filter(Boolean))];
      if (provinceIds.length) {
        const provinces = await this.provinceRepo.findBy({ id: In(provinceIds) });
        for (const province of provinces) for (const alias of cityAliases(province.name)) names.add(alias);
      }
    }
    return { allowAll: false, cityNames: [...names] };
  }

  /** 把范围套到维护表的 org_city 上（三张维护表列结构一致） */
  apply<T extends object>(qb: SelectQueryBuilder<T>, scope: MaintenanceOrgScope, alias: string, provinceAlias = false): SelectQueryBuilder<T> {
    if (scope.allowAll) return qb;
    if (!scope.cityNames.length) return qb.andWhere('1 = 0');
    if (provinceAlias) {
      return qb.andWhere(`(${alias}.orgCity IN (:...scopeCityNames) OR ${alias}.orgProvince IN (:...scopeCityNames))`, { scopeCityNames: scope.cityNames });
    }
    return qb.andWhere(`${alias}.orgCity IN (:...scopeCityNames)`, { scopeCityNames: scope.cityNames });
  }

  /**
   * 写操作的范围校验。
   *
   * 权限点（maintenance.data.write）只回答「这个人能不能改维护数据」，
   * 回答不了「能改哪个地市的」。两者必须叠加：否则地市账号虽然不能进别的菜单，
   * 仍可以直接 PATCH 外市记录的 id 把数据改掉（原实现就是这样，create/update 连登录后的
   * 权限点都没校验）。
   */
  async assertWritable(auth: BizAuthContext, orgCity: string | null | undefined): Promise<void> {
    const scope = await this.resolve(auth);
    if (scope.allowAll) return;
    const city = String(orgCity ?? '').trim();
    if (!city) throw new ForbiddenException('缺少地市，无法判断数据归属');
    // cityNames 同时含「东营市」与「东营」两种写法，这里按别名表逐一比对
    const allowed = scope.cityNames.some((name) => cityAliases(city).includes(name) || name === city);
    if (!allowed) throw new ForbiddenException(`无权维护「${city}」的数据，当前账号范围：${scope.cityNames.join('、') || '无'}`);
  }
}
