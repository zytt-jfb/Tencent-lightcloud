import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnnualPackageEntity } from './annual-package.entity';
import { ContractMonthRowEntity } from './contract-month-row.entity';
import { CostMonthRowEntity } from './cost-month-row.entity';
import { MaintenanceMonthRowEntity } from './maintenance-month-row.entity';
import { MonthSnapshotEntity } from './month-snapshot.entity';
import { MonthUnlockGrantEntity } from './month-unlock-grant.entity';
import { ContractEntity } from '../contracts/contract.entity';
import { AllocationEntity } from '../contracts/allocation.entity';
import { CityEntity } from '../cities/city.entity';
import { OperationLogEntity } from '../common/entities/operation-log.entity';
import { PackagesController } from './packages.controller';
import { AdminPackagesController } from './admin-packages.controller';
import { PackagesService } from './packages.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AnnualPackageEntity,
      ContractMonthRowEntity,
      CostMonthRowEntity,
      MaintenanceMonthRowEntity,
      MonthSnapshotEntity,
      MonthUnlockGrantEntity,
      ContractEntity,
      AllocationEntity,
      CityEntity,
      OperationLogEntity,
    ]),
  ],
  controllers: [PackagesController, AdminPackagesController],
  providers: [PackagesService],
  exports: [PackagesService],
})
export class PackagesModule {}
