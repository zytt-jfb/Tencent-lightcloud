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

@Module({
  imports: [TypeOrmModule.forFeature([MaintenancePersonnelEntity, MaintenanceVehicleEntity, MaintenanceGeneratorEntity])],
  controllers: [MaintenancePersonnelController, MaintenanceVehicleController, MaintenanceGeneratorController],
  providers: [MaintenancePersonnelService, MaintenanceVehicleService, MaintenanceGeneratorService],
})
export class MaintenanceModule {}
