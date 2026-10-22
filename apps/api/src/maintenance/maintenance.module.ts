import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MaintenancePersonnelController } from './personnel/personnel.controller';
import { MaintenancePersonnelEntity } from './personnel/personnel.entity';
import { MaintenancePersonnelService } from './personnel/personnel.service';
import { MaintenanceVehicleEntity } from './vehicles/vehicle.entity';
import { MaintenanceVehicleController } from './vehicles/vehicle.controller';
import { MaintenanceVehicleService } from './vehicles/vehicle.service';
import { MaintenanceGeneratorEntity } from './generators/generator.entity';
import { MaintenanceGeneratorController } from './generators/generator.controller';
import { MaintenanceGeneratorService } from './generators/generator.service';
import { MaintenanceDocumentEntity } from './maintenance-document.entity';
import { MaintenanceDocumentService } from './maintenance-document.service';
import { MaintenanceOverviewController } from './maintenance-overview.controller';
import { MaintenanceOverviewService } from './maintenance-overview.service';
import { MaintenanceScopeService } from './maintenance-scope.service';
import { RbacModule } from '../rbac/rbac.module';
import { CityEntity } from '../main-data/city.entity';
import { ProvinceEntity } from '../main-data/province.entity';
import { FactSourceFileStorageService } from '../facts/fact-source-file-storage.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([MaintenancePersonnelEntity, MaintenanceVehicleEntity, MaintenanceGeneratorEntity, MaintenanceDocumentEntity, CityEntity, ProvinceEntity]),
    RbacModule,
  ],
  controllers: [MaintenanceOverviewController, MaintenancePersonnelController, MaintenanceVehicleController, MaintenanceGeneratorController],
  providers: [MaintenanceOverviewService, MaintenanceScopeService, MaintenancePersonnelService, MaintenanceVehicleService, MaintenanceGeneratorService, MaintenanceDocumentService, FactSourceFileStorageService],
  // 工作台要拿到期待办数字，必须先导出；总览/台账/工作台三处共用 compute() 同一份口径
  exports: [MaintenanceOverviewService],
})
export class MaintenanceModule {}
