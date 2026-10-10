import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CityEntity } from '../cities/city.entity';
import { OperationLogEntity } from '../common/entities/operation-log.entity';
import { AllocationEntity } from '../contracts/allocation.entity';
import { ContractEntity } from '../contracts/contract.entity';
import { AnnualPackageEntity } from '../packages/annual-package.entity';
import { ContractMonthRowEntity } from '../packages/contract-month-row.entity';
import { CostMonthRowEntity } from '../packages/cost-month-row.entity';
import { AdminFactsController } from './admin-facts.controller';
import { CityFactsController } from './city-facts.controller';
import { CostFactEntity } from './cost-fact.entity';
import { FactImportBatchEntity } from './fact-import-batch.entity';
import { FactLifecycleService } from './fact-lifecycle.service';
import { FactImportService } from './fact-import.service';
import { FactSourceRowEntity } from './fact-source-row.entity';
import { FactSourceFileStorageService } from './fact-source-file-storage.service';
import { FactVersionEntity } from './fact-version.entity';
import { AdminFactVersionsController, CityFactVersionsController } from './fact-versions.controller';
import { FactsService } from './facts.service';
import { OrderFactEntity } from './order-fact.entity';

@Module({
  imports: [TypeOrmModule.forFeature([
    FactImportBatchEntity, FactSourceRowEntity, CostFactEntity, OrderFactEntity, FactVersionEntity,
    CityEntity, ContractEntity, AllocationEntity, OperationLogEntity,
    AnnualPackageEntity, ContractMonthRowEntity, CostMonthRowEntity,
  ])],
  controllers: [CityFactsController, AdminFactsController, CityFactVersionsController, AdminFactVersionsController],
  providers: [FactsService, FactImportService, FactLifecycleService, FactSourceFileStorageService],
  exports: [FactsService, FactSourceFileStorageService],
})
export class FactsModule {}



