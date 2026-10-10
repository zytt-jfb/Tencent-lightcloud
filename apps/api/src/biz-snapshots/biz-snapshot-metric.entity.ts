import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

/**
 * 快照指标表：保存某快照下各维度（current/year/month × 省/市）的聚合结果。
 * 唯一键保证 (snapshotId, periodType, periodKey, provinceId, cityId) 不重复，
 * 多月份/多地市筛选时直接读取，不再即时组合计算。
 */
@Entity('biz_snapshot_metrics')
@Index('uk_snapshot_metric', ['snapshotId', 'periodType', 'periodKey', 'provinceId', 'cityId'], { unique: true })
export class BizSnapshotMetricEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'snapshot_id', type: 'uuid' })
  @Index('idx_snapshot_metric_snapshot')
  snapshotId: string;

  @Column({ name: 'period_type', type: 'varchar', length: 16 })
  periodType: string;

  @Column({ name: 'period_key', type: 'varchar', length: 16 })
  periodKey: string;

  @Column({ name: 'province_id', type: 'varchar', length: 36, nullable: true })
  provinceId: string | null;

  @Column({ name: 'city_id', type: 'varchar', length: 36, nullable: true })
  cityId: string | null;

  @Column({ name: 'contract_count', type: 'int', default: 0 })
  contractCount: number;

  @Column({ name: 'contract_amount_fen', type: 'bigint', default: 0 })
  contractAmountFen: number;

  @Column({ name: 'completion_fen', type: 'bigint', default: 0 })
  completionFen: number;

  @Column({ name: 'order_completion_fen', type: 'bigint', default: 0 })
  orderCompletionFen: number;

  @Column({ name: 'offline_completion_fen', type: 'bigint', default: 0 })
  offlineCompletionFen: number;

  @Column({ name: 'cost_fen', type: 'bigint', default: 0 })
  costFen: number;

  @Column({ name: 'gross_profit_fen', type: 'bigint', default: 0 })
  grossProfitFen: number;

  @Column({ name: 'net_profit_fen', type: 'bigint', default: 0 })
  netProfitFen: number;
}
