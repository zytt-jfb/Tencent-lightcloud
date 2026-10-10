import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BizContractEntity } from '../contracts/biz-contract.entity';
import { BizContractCityAllocationEntity } from '../contracts/biz-contract-city-allocation.entity';
import { BizContractFeeRateEntity } from '../contracts/biz-contract-fee-rate.entity';
import { BizFeeRateImportTaskEntity } from '../contracts/biz-fee-rate-import-task.entity';
import { BizFeeRateImportTaskRowEntity } from '../contracts/biz-fee-rate-import-task-row.entity';
import { BizOrderRowEntity } from '../orders/biz-order-row.entity';
import { ProvinceEntity } from '../main-data/province.entity';
import { CityEntity } from '../main-data/city.entity';
import { BizOperationLogEntity } from '../operation-logs/biz-operation-log.entity';
import { RbacModule } from '../rbac/rbac.module';
import { BizContractsModule } from '../biz-contracts/biz-contracts.module';
import { BizFeeRatesService } from './biz-fee-rates.service';
import { BizFeeRatesController } from './biz-fee-rates.controller';

/**
 * 管理费率批量维护模块
 * 复用既有费率模型（biz_contract_fee_rates）与既有订单重算逻辑（BizContractsService），
 * 仅新增批量导入任务表用于"预览—确认"流程与审计。
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      BizContractEntity,
      BizContractCityAllocationEntity,
      BizContractFeeRateEntity,
      BizFeeRateImportTaskEntity,
      BizFeeRateImportTaskRowEntity,
      BizOrderRowEntity,
      ProvinceEntity,
      CityEntity,
      BizOperationLogEntity,
    ]),
    RbacModule,
    BizContractsModule,
  ],
  controllers: [BizFeeRatesController],
  providers: [BizFeeRatesService],
  exports: [BizFeeRatesService],
})
export class BizFeeRatesModule {}
