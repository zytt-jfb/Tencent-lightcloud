import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CityEntity } from './city.entity';
import { CitiesController } from './cities.controller';
import { AdminCitiesController } from './admin-cities.controller';
import { AdminCitiesService } from './admin-cities.service';
import { OperationLogEntity } from '../common/entities/operation-log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CityEntity, OperationLogEntity])],
  controllers: [CitiesController, AdminCitiesController],
  providers: [AdminCitiesService],
})
export class CitiesModule {}
