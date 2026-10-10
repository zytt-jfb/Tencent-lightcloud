import { Entity, Column, PrimaryGeneratedColumn, Index, Unique } from 'typeorm';

/**
 * 快照合同成员表：记录某快照下纳入计算的合同清单（按 合同 ID + 分配地市 去重，一个合同跨多地市生成多行）。
 * 保证：当前合同数与历史月份合同数均可正确计算，不会把多月份合同数重复累加。
 * is_expired_at_asof：快照基准日是否已到期（库存口径仍计入合同数，但经营金额/完工/毛利/净利排除）。
 * contract_amount_fen / quota_fen：用于按地市配额分摊合同额（与 byCity 同一口径），经营口径排除到期合同。
 */
@Entity('biz_snapshot_contracts')
@Unique('uk_snapshot_contract', ['snapshotId', 'contractId', 'cityId'])
export class BizSnapshotContractEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'snapshot_id', type: 'uuid' })
  @Index('idx_snapshot_contract_snapshot')
  snapshotId: string;

  @Column({ name: 'contract_id', type: 'varchar', length: 36 })
  contractId: string;

  @Column({ name: 'province_id', type: 'varchar', length: 36, nullable: true })
  provinceId: string | null;

  @Column({ name: 'city_id', type: 'varchar', length: 36 })
  cityId: string;

  @Column({ name: 'contract_amount_fen', type: 'bigint', default: 0 })
  contractAmountFen: number;

  @Column({ name: 'quota_fen', type: 'bigint', default: 0 })
  quotaFen: number;

  /** 快照基准日的累计完工（订单 valid 非 void + 线下 approved）；用于经营单位详情"合同明细及累计完工"与进度计算 */
  @Column({ name: 'completion_fen', type: 'bigint', default: 0 })
  completionFen: number;

  @Column({ name: 'is_expired_at_asof', type: 'tinyint', width: 1, default: 0 })
  isExpiredAtAsOf: number;
}
