import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PerformanceBatchEntity, PerformanceRecordEntity } from './performance.entity';
import { PerformanceController } from './performance.controller';
import { PerformanceService } from './performance.service';
import { BizOperationLogEntity } from '../operation-logs/biz-operation-log.entity';
import { RbacModule } from '../rbac/rbac.module';
import { CityEntity } from '../main-data/city.entity';

/** 绩效（月度考核）：数据范围要把地市 UUID 换成名称，故需要地市字典与 AccessScopeService */
@Module({
  imports: [TypeOrmModule.forFeature([PerformanceBatchEntity, PerformanceRecordEntity, BizOperationLogEntity, CityEntity]), RbacModule],
  controllers: [PerformanceController],
  providers: [PerformanceService],
})
export class PerformanceModule {}
