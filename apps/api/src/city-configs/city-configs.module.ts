import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CityConfigEntity } from './city-config.entity';
import { CityEntity } from '../cities/city.entity';
import { OperationLogEntity } from '../common/entities/operation-log.entity';
import { CityConfigsController } from './city-configs.controller';
import { CityConfigsController as CityConfigsCityController } from './city-configs.controller.city';
import { CityConfigsService } from './city-configs.service';

@Module({
  imports: [TypeOrmModule.forFeature([CityConfigEntity, CityEntity, OperationLogEntity])],
  controllers: [CityConfigsController, CityConfigsCityController],
  providers: [CityConfigsService],
})
export class CityConfigsModule {}
