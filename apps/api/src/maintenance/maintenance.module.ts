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
import { FactSourceFileStorageService } from '../facts/fact-source-file-storage.service';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [ConfigModule, TypeOrmModule.forFeature([MaintenancePersonnelEntity, MaintenanceVehicleEntity, MaintenanceGeneratorEntity, MaintenanceDocumentEntity])],
  controllers: [MaintenancePersonnelController, MaintenanceVehicleController, MaintenanceGeneratorController],
  providers: [MaintenancePersonnelService, MaintenanceVehicleService, MaintenanceGeneratorService, MaintenanceDocumentService, FactSourceFileStorageService],
})
export class MaintenanceModule {}
