import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BizOrderImportBatchEntity } from '../orders/biz-order-import-batch.entity';
import { BizOrderRowEntity } from '../orders/biz-order-row.entity';
import { BizOrderImportErrorEntity } from '../orders/biz-order-import-error.entity';
import { BizContractEntity } from '../contracts/biz-contract.entity';
import { BizContractCityAllocationEntity } from '../contracts/biz-contract-city-allocation.entity';
import { BizContractFeeRateEntity } from '../contracts/biz-contract-fee-rate.entity';
import { ProvinceEntity } from '../main-data/province.entity';
import { CityEntity } from '../main-data/city.entity';
import { CityAliasEntity } from '../main-data/city-alias.entity';
import { BizOperationLogEntity } from '../operation-logs/biz-operation-log.entity';
import { PlatformUserEntity } from '../rbac/platform-user.entity';
import { RbacModule } from '../rbac/rbac.module';
import { BizContractsModule } from '../biz-contracts/biz-contracts.module';
import { BizAggregatesModule } from '../biz-aggregates/biz-aggregates.module';
import { BizDataDeletionModule } from '../biz-data-deletion/biz-data-deletion.module';
import { BizOrderImportService } from './biz-order-import.service';
import { BizOrdersController } from './biz-orders.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BizOrderImportBatchEntity,
      BizOrderRowEntity,
      BizOrderImportErrorEntity,
      BizContractEntity,
      BizContractCityAllocationEntity,
      BizContractFeeRateEntity,
      ProvinceEntity,
      CityEntity,
      CityAliasEntity,
      BizOperationLogEntity,
      PlatformUserEntity,
    ]),
    RbacModule,
    BizContractsModule,
    BizAggregatesModule,
    BizDataDeletionModule,
  ],
  controllers: [BizOrdersController],
  providers: [BizOrderImportService],
  exports: [BizOrderImportService],
})
export class BizOrdersModule {}
