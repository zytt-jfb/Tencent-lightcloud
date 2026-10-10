import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BizMonthlyAggregateEntity } from '../aggregates/biz-monthly-aggregate.entity';
import { BizAggregateFailureEntity } from '../aggregates/biz-aggregate-failure.entity';
import { BizSystemSettingEntity } from '../aggregates/biz-system-setting.entity';
import { BizOrderRowEntity } from '../orders/biz-order-row.entity';
import { BizOfflineCompletionEntity } from '../completions/biz-offline-completion.entity';
import { BizCostEntryEntity } from '../costs/biz-cost-entry.entity';
import { BizContractEntity } from '../contracts/biz-contract.entity';
import { BizContractCityAllocationEntity } from '../contracts/biz-contract-city-allocation.entity';
import { BizOperationLogEntity } from '../operation-logs/biz-operation-log.entity';
import { CityEntity } from '../main-data/city.entity';
import { ProvinceEntity } from '../main-data/province.entity';
import { RbacModule } from '../rbac/rbac.module';
import { BizAggregateService } from './biz-aggregate.service';
import { BizAggregateController } from './biz-aggregate.controller';
import { BizSnapshotRunEntity } from '../biz-snapshots/biz-snapshot-run.entity';
import { BizSnapshotRegistryEntity } from '../biz-snapshots/biz-snapshot-registry.entity';
import { BizSnapshotMetricEntity } from '../biz-snapshots/biz-snapshot-metric.entity';
import { BizSnapshotAlertEntity } from '../biz-snapshots/biz-snapshot-alert.entity';
import { BizSnapshotContractEntity } from '../biz-snapshots/biz-snapshot-contract.entity';
import { BizSnapshotOverrunEntity } from '../biz-snapshots/biz-snapshot-overrun.entity';
import { BizSnapshotOverrunPeriodEntity } from '../biz-snapshots/biz-snapshot-overrun-period.entity';
import { BizSnapshotContractLedgerEntity } from '../biz-snapshots/biz-snapshot-contract-ledger.entity';
import { BizSnapshotService } from '../biz-snapshots/biz-snapshot.service';
import { BizSnapshotScheduler } from '../biz-snapshots/biz-snapshot.scheduler';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BizMonthlyAggregateEntity,
      BizAggregateFailureEntity,
      BizSystemSettingEntity,
      BizOrderRowEntity,
      BizOfflineCompletionEntity,
      BizCostEntryEntity,
      BizContractEntity,
      BizContractCityAllocationEntity,
      BizOperationLogEntity,
      CityEntity,
      ProvinceEntity,
      BizSnapshotRunEntity,
      BizSnapshotRegistryEntity,
      BizSnapshotMetricEntity,
      BizSnapshotAlertEntity,
      BizSnapshotContractEntity,
      BizSnapshotOverrunEntity,
      BizSnapshotOverrunPeriodEntity,
      BizSnapshotContractLedgerEntity,
    ]),
    RbacModule,
  ],
  controllers: [BizAggregateController],
  providers: [BizAggregateService, BizSnapshotService, BizSnapshotScheduler],
  exports: [BizAggregateService, BizSnapshotService],
})
export class BizAggregatesModule {}
