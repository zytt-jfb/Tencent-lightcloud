import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

/**
 * 期间超额快照（新增）：与经营分析快照在同一构建任务/事务中生成并切换。
 * 支持按 period_type/period_key 过滤，使超额清单真正响应年度/月度筛选，
 * 而非仅改变下拉框而返回同一批累计数据。
 *
 *  - period_type: 'month'（某自然月）| 'current'（该年 YTD 累计，等同全局累计）
 *  - period_key : 'YYYY-MM' 或 'current'
 *  - type       : 'contract'（合同累计完工 > 合同额）| 'city'（地市累计完工 > 地市总配额）
 *  - completion_fen / quota_fen / overrun_fen 均为"截至该 period_key 末"的累计值。
 */
@Entity({ name: 'biz_snapshot_overrun_periods' })
export class BizSnapshotOverrunPeriodEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id: string;

  @Index()
  @Column('varchar', { name: 'snapshot_id', length: 36 })
  snapshotId: string;

  @Column('varchar', { name: 'period_type', length: 16 })
  periodType: string;

  @Column('varchar', { name: 'period_key', length: 16 })
  periodKey: string;

  @Column('varchar', { name: 'type', length: 16 })
  type: string;

  @Column('varchar', { name: 'contract_id', length: 36, nullable: true })
  contractId: string | null;

  @Column('varchar', { name: 'city_id', length: 36, nullable: true })
  cityId: string | null;

  @Column('varchar', { name: 'province_id', length: 36, nullable: true })
  provinceId: string | null;

  @Column('varchar', { name: 'contract_no', length: 64, nullable: true })
  contractNo: string | null;

  @Column('varchar', { name: 'contract_name', length: 255, nullable: true })
  contractName: string | null;

  @Column('varchar', { name: 'city_name', length: 128, nullable: true })
  cityName: string | null;

  @Column('bigint', { name: 'completion_fen', default: 0 })
  completionFen: number;

  @Column('bigint', { name: 'quota_fen', default: 0 })
  quotaFen: number;

  @Column('bigint', { name: 'overrun_fen', default: 0 })
  overrunFen: number;
}
