import { Controller, Get, UseGuards } from '@nestjs/common';
import { Public } from './common/decorators/public.decorator';
import { BizAuthGuard } from './biz-auth/biz-auth.guard';
import { BizAuthUser } from './biz-auth/biz-auth-user.decorator';
import { BizAuthContext } from './rbac/rbac.service';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CityEntity } from './main-data/city.entity';
import { ProvinceEntity } from './main-data/province.entity';

/**
 * biz 通用只读 API（当前登录用户可见范围内的主数据）
 * GET /biz/cities —— 当前账号数据范围内的城市清单（city_user→其绑定城市；admin/super→全部）。
 *   仅 BizAuthGuard 鉴权，不要求任何管理权限，供业务分析/筛选下拉使用。
 */
@Controller('biz')
@Public()
@UseGuards(BizAuthGuard)
export class BizCommonController {
  constructor(
    @InjectRepository(CityEntity)
    private readonly cityRepo: Repository<CityEntity>,
    @InjectRepository(ProvinceEntity)
    private readonly provinceRepo: Repository<ProvinceEntity>,
  ) {}

  /** 当前账号可见城市：按数据范围（cityIds / provinceIds / allowAll）过滤 */
  @Get('cities')
  async cities(@BizAuthUser() auth: BizAuthContext) {
    const scope = auth.dataScope;
    let entities: CityEntity[];
    if (scope.allowAll) {
      entities = await this.cityRepo.find({ order: { code: 'ASC' } });
    } else if (scope.cityIds && scope.cityIds.length > 0) {
      entities = await this.cityRepo.find({ where: { id: In(scope.cityIds) }, order: { code: 'ASC' } });
    } else if (scope.provinceIds && scope.provinceIds.length > 0) {
      entities = await this.cityRepo.find({ where: { provinceId: In(scope.provinceIds) }, order: { code: 'ASC' } });
    } else {
      entities = [];
    }
    return {
      items: entities.map((c) => ({
        id: c.id,
        code: c.code,
        name: c.name,
        provinceId: c.provinceId,
        unitType: c.unitType,
      })),
    };
  }

  /**
   * 当前账号可见省份：按数据范围推导。
   * allowAll → 全部省份；provinceIds → 那些省份；cityIds → 这些城市所属省份；其余 → 空。
   * 仅 BizAuthGuard 鉴权，不要求管理权限，供筛选下拉使用。
   */
  @Get('provinces')
  async provinces(@BizAuthUser() auth: BizAuthContext) {
    const scope = auth.dataScope;
    let entities: ProvinceEntity[];
    if (scope.allowAll || scope.scopeType === 'contract') {
      entities = await this.provinceRepo.find({ order: { code: 'ASC' } });
    } else {
      let provinceIds: string[] = [];
      if (scope.provinceIds && scope.provinceIds.length > 0) {
        provinceIds = scope.provinceIds;
      } else if (scope.cityIds && scope.cityIds.length > 0) {
        const cities = await this.cityRepo.find({ where: { id: In(scope.cityIds) }, select: ['provinceId'] });
        provinceIds = Array.from(new Set(cities.map((c) => c.provinceId).filter((id): id is string => !!id)));
      }
      entities = provinceIds.length > 0
        ? await this.provinceRepo.find({ where: { id: In(provinceIds) }, order: { code: 'ASC' } })
        : [];
    }
    return {
      items: entities.map((p) => ({ id: p.id, code: p.code, name: p.name })),
    };
  }
}
