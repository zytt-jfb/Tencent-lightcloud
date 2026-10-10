import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CityConfigEntity } from './city-config.entity';
import { CityEntity } from '../cities/city.entity';
import { OperationLogEntity } from '../common/entities/operation-log.entity';
import type { CityConfigDto } from '@biz-reporting/shared-types';

@Injectable()
export class CityConfigsService {
  constructor(
    @InjectRepository(CityConfigEntity)
    private readonly configRepo: Repository<CityConfigEntity>,
    @InjectRepository(CityEntity)
    private readonly cityRepo: Repository<CityEntity>,
    @InjectRepository(OperationLogEntity)
    private readonly operationLogRepo: Repository<OperationLogEntity>,
  ) {}

  async list(): Promise<CityConfigDto[]> {
    const cities = await this.cityRepo.find();
    const configs = await this.configRepo.find();
    const configMap = new Map(configs.map((c) => [c.cityId, c]));

    return cities.map((city) => {
      const cfg = configMap.get(city.id);
      return {
        cityId: city.id,
        cityName: city.name,
        enableMaintenance: cfg?.enableMaintenance ?? false,
        updatedBy: cfg?.updatedBy ?? null,
        updatedAt: cfg?.updatedAt?.toISOString() ?? null,
      };
    });
  }

  /**
   * 根据 cityId 获取单条城市配置（城市端使用）
   */
  async getByCityId(cityId: number): Promise<{ cityId: number; cityName: string; enableMaintenance: boolean }> {
    const city = await this.cityRepo.findOne({ where: { id: cityId } });
    if (!city) throw new NotFoundException(`城市 #${cityId} 不存在`);

    const cfg = await this.configRepo.findOne({ where: { cityId } });

    return {
      cityId: city.id,
      cityName: city.name,
      enableMaintenance: cfg?.enableMaintenance ?? false,
    };
  }

  async update(
    cityId: number,
    enableMaintenance: boolean,
    operatorUserId: number,
  ): Promise<CityConfigDto> {
    const city = await this.cityRepo.findOne({ where: { id: cityId } });
    if (!city) throw new NotFoundException(`城市 #${cityId} 不存在`);

    let cfg = await this.configRepo.findOne({ where: { cityId } });
    const beforeValue = cfg?.enableMaintenance ?? false;

    if (!cfg) {
      cfg = this.configRepo.create({ cityId, enableMaintenance: false });
    }
    cfg.enableMaintenance = enableMaintenance;
    cfg.updatedBy = operatorUserId;
    await this.configRepo.save(cfg);

    await this.operationLogRepo.save(
      this.operationLogRepo.create({
        operatorUserId,
        actionType: 'city_config_update',
        targetType: 'city_config',
        targetId: String(cityId),
        summaryText: `管理员将城市 ${city.name} 的 enableMaintenance 从 ${beforeValue} 改为 ${enableMaintenance}`,
        beforeDataJson: { enableMaintenance: beforeValue },
        afterDataJson: { enableMaintenance },
        resultStatus: 'success',
      }),
    );

    return {
      cityId: city.id,
      cityName: city.name,
      enableMaintenance: cfg.enableMaintenance,
      updatedBy: cfg.updatedBy,
      updatedAt: cfg.updatedAt?.toISOString() ?? null,
    };
  }
}
