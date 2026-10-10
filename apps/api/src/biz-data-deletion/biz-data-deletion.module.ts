import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BizAggregatesModule } from '../biz-aggregates/biz-aggregates.module';
import { RbacModule } from '../rbac/rbac.module';
import { BizOrderImportBatchEntity } from '../orders/biz-order-import-batch.entity';
import { BizOrderImportErrorEntity } from '../orders/biz-order-import-error.entity';
import { BizOrderRowEntity } from '../orders/biz-order-row.entity';
import { BizContractImportRecordEntity } from '../contracts/biz-contract-import-record.entity';
import { BizContractImportSheetEntity } from '../contracts/biz-contract-import-sheet.entity';
import { BizContractSourceRowEntity } from '../contracts/biz-contract-source-row.entity';
import { BizContractEntity } from '../contracts/biz-contract.entity';
import { BizContractCityAllocationEntity } from '../contracts/biz-contract-city-allocation.entity';
import { BizContractFeeRateEntity } from '../contracts/biz-contract-fee-rate.entity';
import { BizContractAlertEntity } from '../contracts/biz-contract-alert.entity';
import { BizOfflineCompletionEntity } from '../completions/biz-offline-completion.entity';
import { BizCostEntryEntity } from '../costs/biz-cost-entry.entity';
import { BizCostCategoryEntity } from '../costs/biz-cost-category.entity';
import { ProvinceEntity } from '../main-data/province.entity';
import { CityEntity } from '../main-data/city.entity';
import { CityAliasEntity } from '../main-data/city-alias.entity';
import { BizAnnouncementEntity } from '../biz-communications/biz-announcement.entity';
import { BizAnnouncementReadEntity } from '../biz-communications/biz-announcement-read.entity';
import { BizMessageEntity } from '../reminders/biz-message.entity';
import { BizOperationLogEntity } from '../operation-logs/biz-operation-log.entity';
import { BizDataDeletionController } from './biz-data-deletion.controller';
import { BizDataDeletionService } from './biz-data-deletion.service';

@Module({
  imports: [TypeOrmModule.forFeature([
    BizOrderImportBatchEntity, BizOrderImportErrorEntity, BizOrderRowEntity,
    BizContractImportRecordEntity, BizContractImportSheetEntity, BizContractSourceRowEntity,
    BizContractEntity, BizContractCityAllocationEntity, BizContractFeeRateEntity, BizContractAlertEntity,
    BizOfflineCompletionEntity, BizCostEntryEntity, BizCostCategoryEntity,
    ProvinceEntity, CityEntity, CityAliasEntity, BizAnnouncementEntity, BizAnnouncementReadEntity,
    BizMessageEntity, BizOperationLogEntity,
  ]), RbacModule, BizAggregatesModule],
  controllers: [BizDataDeletionController],
  providers: [BizDataDeletionService],
  exports: [BizDataDeletionService],
})
export class BizDataDeletionModule {}
