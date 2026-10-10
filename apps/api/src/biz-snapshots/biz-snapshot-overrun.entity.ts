import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

/**
 * 快照超额表：某快照下纳入计算的超额清单（合同超额 + 经营单位超额），
 * 与 metrics/contracts/alerts 同属一个 snapshotId，保证超额清单与其它分析页读取同一份快照。
 * 过滤规则：与预警一致，按请求用户数据范围在查询时过滤（绝不写入用户范围）。
 */
@Entity('biz_snapshot_overruns')
export class BizSnapshotOverrunEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'snapshot_id', type: 'uuid' })
  @Index('idx_snapshot_overrun_snapshot')
  snapshotId: string;

  /** 'contract' = 合同超额；'city' = 经营单位（地市）超额 */
  @Column({ name: 'type', type: 'varchar', length: 16 })
  type: 'contract' | 'city';

  @Column({ name: 'contract_id', type: 'varchar', length: 36, nullable: true })
  contractId: string | null;

  @Column({ name: 'province_id', type: 'varchar', length: 36, nullable: true })
  provinceId: string | null;

  @Column({ name: 'city_id', type: 'varchar', length: 36, nullable: true })
  cityId: string | null;

  @Column({ name: 'contract_no', type: 'varchar', length: 64, nullable: true })
  contractNo: string | null;

  @Column({ name: 'contract_name', type: 'varchar', length: 255, nullable: true })
  contractName: string | null;

  @Column({ name: 'city_name', type: 'varchar', length: 128, nullable: true })
  cityName: string | null;

  @Column({ name: 'completion_fen', type: 'bigint', default: 0 })
  completionFen: number;

  @Column({ name: 'quota_fen', type: 'bigint', default: 0 })
  quotaFen: number;

  @Column({ name: 'overrun_fen', type: 'bigint', default: 0 })
  overrunFen: number;
}
