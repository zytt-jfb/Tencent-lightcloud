import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssessmentBatchEntity } from './assessment-batch.entity';
import { AssessmentRecordEntity } from './assessment-record.entity';
import { BizContractEntity } from '../contracts/biz-contract.entity';
import { BizContractCityAllocationEntity } from '../contracts/biz-contract-city-allocation.entity';
import { BizOperationLogEntity } from '../operation-logs/biz-operation-log.entity';
import { CityEntity } from '../main-data/city.entity';
import { CityAliasEntity } from '../main-data/city-alias.entity';
import { ProvinceEntity } from '../main-data/province.entity';
import { RbacModule } from '../rbac/rbac.module';
import { BizAssessmentsController } from './biz-assessments.controller';
import { BizAssessmentsImportService } from './biz-assessments-import.service';
import { BizAssessmentsQueryService } from './biz-assessments-query.service';
import { BizAssessmentsEntryService } from './biz-assessments-entry.service';
import { BizAssessmentsScorecardService } from './biz-assessments-scorecard.service';

/**
 * 工程管理 / 后评估管理模块
 * 表：biz_assessment_batch（导入批次）、biz_assessment_record（事实表，导入与线下填报共用）
 * 建表走迁移 040_biz_assessment，不走 SNAPSHOT_DDL（这是业务表，不是统计快照）
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      AssessmentBatchEntity,
      AssessmentRecordEntity,
      BizContractEntity,
      BizContractCityAllocationEntity,
      BizOperationLogEntity,
      CityEntity,
      CityAliasEntity,
      ProvinceEntity,
    ]),
    RbacModule,
  ],
  controllers: [BizAssessmentsController],
  providers: [BizAssessmentsImportService, BizAssessmentsQueryService, BizAssessmentsEntryService, BizAssessmentsScorecardService],
  // EntryService 供工作台统计「待提交填报」，复用其数据范围收敛逻辑
  exports: [BizAssessmentsQueryService, BizAssessmentsEntryService],
})
export class BizAssessmentsModule {}
