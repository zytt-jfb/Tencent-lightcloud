import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PerformanceBatchEntity, PerformanceRecordEntity } from './performance.entity';
import { PerformanceController } from './performance.controller';
import { PerformanceService } from './performance.service';
import { BizOperationLogEntity } from '../operation-logs/biz-operation-log.entity';

@Module({ imports: [TypeOrmModule.forFeature([PerformanceBatchEntity, PerformanceRecordEntity, BizOperationLogEntity])], controllers: [PerformanceController], providers: [PerformanceService] })
export class PerformanceModule {}
