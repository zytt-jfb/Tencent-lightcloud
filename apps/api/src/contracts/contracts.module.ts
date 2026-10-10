import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ContractEntity } from './contract.entity';
import { AllocationEntity } from './allocation.entity';
import { ContractCityBusinessMetricEntity } from './contract-city-business-metric.entity';
import { CityEntity } from '../cities/city.entity';
import { ContractsController } from './contracts.controller';
import { AllocationsController } from './allocations.controller';
import { ContractsService } from './contracts.service';

@Module({
  imports: [TypeOrmModule.forFeature([ContractEntity, AllocationEntity, ContractCityBusinessMetricEntity, CityEntity])],
  controllers: [ContractsController, AllocationsController],
  providers: [ContractsService],
  exports: [ContractsService],
})
export class ContractsModule {}
