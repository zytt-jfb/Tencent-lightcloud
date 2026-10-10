import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CityEntity } from './city.entity';
import { Permission } from '@biz-reporting/shared-types';
import { Permissions } from '../common/decorators/permissions.decorator';

@ApiTags('Cities')
@Controller('cities')
@Permissions(Permission.CITIES_READ)
export class CitiesController {
  constructor(
    @InjectRepository(CityEntity)
    private readonly repo: Repository<CityEntity>,
  ) {}

  @Get()
  @ApiOperation({ summary: '获取城市列表' })
  async list() {
    const cities = await this.repo.find({ where: { isDeleted: 0 }, order: { sortOrder: 'ASC' } });
    return cities.map((c) => ({ id: c.id, name: c.name }));
  }
}
