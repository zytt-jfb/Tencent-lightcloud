import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OperationLogEntity } from '../common/entities/operation-log.entity';
import { CityEntity } from './city.entity';

export interface CreateCityInput {
  name: string;
  code?: string | null;
  sortOrder?: number;
}

export interface UpdateCityInput {
  name?: string;
  code?: string | null;
  sortOrder?: number;
}

@Injectable()
export class AdminCitiesService {
  constructor(
    @InjectRepository(CityEntity)
    private readonly cityRepo: Repository<CityEntity>,
    @InjectRepository(OperationLogEntity)
    private readonly operationLogRepo: Repository<OperationLogEntity>,
  ) {}

  async list() {
    const cities = await this.cityRepo.find({ order: { sortOrder: 'ASC', id: 'ASC' } });
    return cities.map((city) => this.toResponse(city));
  }

  async create(input: CreateCityInput, operatorUserId: number) {
    const name = input.name.trim();
    if (!name) throw new BadRequestException('City name is required');
    const city = await this.cityRepo.save(this.cityRepo.create({
      name,
      code: input.code?.trim() || null,
      sortOrder: input.sortOrder ?? 0,
      isDeleted: 0,
      deletedAt: null,
    }));
    await this.log(operatorUserId, 'city_create', city.id, null, this.toResponse(city));
    return this.toResponse(city);
  }

  async update(cityId: number, input: UpdateCityInput, operatorUserId: number) {
    const city = await this.cityRepo.findOne({ where: { id: cityId } });
    if (!city) throw new NotFoundException('City not found');
    const before = this.toResponse(city);
    if (input.name !== undefined) {
      const name = input.name.trim();
      if (!name) throw new BadRequestException('City name is required');
      city.name = name;
    }
    if (input.code !== undefined) city.code = input.code?.trim() || null;
    if (input.sortOrder !== undefined) city.sortOrder = input.sortOrder;
    const saved = await this.cityRepo.save(city);
    await this.log(operatorUserId, 'city_update', city.id, before, this.toResponse(saved));
    return this.toResponse(saved);
  }

  async softDelete(cityId: number, operatorUserId: number) {
    const city = await this.cityRepo.findOne({ where: { id: cityId, isDeleted: 0 } });
    if (!city) throw new NotFoundException('Active city not found');
    const before = this.toResponse(city);
    city.isDeleted = 1;
    city.deletedAt = new Date();
    const saved = await this.cityRepo.save(city);
    await this.log(operatorUserId, 'city_soft_delete', city.id, before, this.toResponse(saved));
    return { success: true, city: this.toResponse(saved) };
  }

  private toResponse(city: CityEntity) {
    return {
      id: city.id,
      name: city.name,
      code: city.code,
      sortOrder: city.sortOrder,
      isDeleted: city.isDeleted === 1,
      deletedAt: city.deletedAt,
    };
  }

  private async log(operatorUserId: number, actionType: string, cityId: number, beforeDataJson: unknown, afterDataJson: unknown) {
    await this.operationLogRepo.save(this.operationLogRepo.create({
      operatorUserId,
      operatorCityId: null,
      actionType,
      targetType: 'city',
      targetId: String(cityId),
      summaryText: actionType,
      beforeDataJson,
      afterDataJson,
      resultStatus: 'success',
    }));
  }
}
