import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminImportsController } from './admin-imports.controller';
import { AdminImportJobsController } from './admin-import-jobs.controller';
import { AdminRecalcController } from './admin-recalc.controller';
import { CityImportsController } from './city-imports.controller';
import { CityImportJobsController } from './city-import-jobs.controller';
import { ExportsController } from './exports.controller';
import { ImportsController } from './imports.controller';
import { ContractImportService } from './contract-import.service';
import { ExportJobEntity } from './export-job.entity';
import { ImportJobEntity } from './import-job.entity';
import { RecalcTaskEntity } from './recalc-task.entity';
import { ReportingImportService } from './reporting-import.service';
import { Ws6Service } from './ws6.service';
import { AllocationEntity } from '../contracts/allocation.entity';
import { ContractCityBusinessMetricEntity } from '../contracts/contract-city-business-metric.entity';
import { ContractEntity } from '../contracts/contract.entity';
import { CityEntity } from '../cities/city.entity';
import { AnnualPackageEntity } from '../packages/annual-package.entity';
import { ContractMonthRowEntity } from '../packages/contract-month-row.entity';
import { CostMonthRowEntity } from '../packages/cost-month-row.entity';
import { MaintenanceMonthRowEntity } from '../packages/maintenance-month-row.entity';
import { MonthSnapshotEntity } from '../packages/month-snapshot.entity';
import { UserEntity } from '../users/user.entity';
import { OperationLogEntity } from '../common/entities/operation-log.entity';
import { FactsModule } from '../facts/facts.module';

@Module({
  imports: [
    FactsModule,
    TypeOrmModule.forFeature([
      ImportJobEntity,
      ExportJobEntity,
      RecalcTaskEntity,
      ContractEntity,
      AllocationEntity,
      ContractCityBusinessMetricEntity,
      CityEntity,
      AnnualPackageEntity,
      ContractMonthRowEntity,
      CostMonthRowEntity,
      MaintenanceMonthRowEntity,
      MonthSnapshotEntity,
      UserEntity,
      OperationLogEntity,
    ]),
  ],
  controllers: [
    AdminImportsController,
    AdminImportJobsController,
    CityImportsController,
    CityImportJobsController,
    ImportsController,
    ExportsController,
    AdminRecalcController,
  ],
  providers: [Ws6Service, ContractImportService, ReportingImportService],
  exports: [Ws6Service],
})
export class Ws6Module {}
