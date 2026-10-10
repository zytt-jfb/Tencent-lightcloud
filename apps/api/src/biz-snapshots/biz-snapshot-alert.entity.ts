import { Entity, Column, PrimaryGeneratedColumn, Index } from 'typeorm';

/**
 * 快照预警表：保存某快照下的合同预警（含完工进度）。
 * 前端直接读取 completionFen / contractAmountFen / completionProgressPct，
 * 不再逐条调用合同详情接口（避免 N+1）。
 */
@Entity('biz_snapshot_alerts')
@Index('idx_snapshot_alert_snapshot', ['snapshotId'])
export class BizSnapshotAlertEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'snapshot_id', type: 'uuid' })
  snapshotId: string;

  @Column({ name: 'contract_id', type: 'varchar', length: 36 })
  contractId: string;

  @Column({ name: 'province_id', type: 'varchar', length: 36, nullable: true })
  provinceId: string | null;

  @Column({ name: 'city_id', type: 'varchar', length: 36, nullable: true })
  cityId: string | null;

  @Column({ name: 'contract_no', type: 'varchar', length: 64, nullable: true })
  contractNo: string | null;

  @Column({ name: 'contract_name', type: 'varchar', length: 255, nullable: true })
  contractName: string | null;

  @Column({ name: 'alert_type', type: 'varchar', length: 32 })
  alertType: string;

  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate: string | null;

  @Column({ name: 'contract_amount_fen', type: 'bigint', nullable: true })
  contractAmountFen: number | null;

  @Column({ name: 'completion_fen', type: 'bigint', nullable: true })
  completionFen: number | null;

  @Column({ name: 'completion_progress_pct', type: 'decimal', precision: 7, scale: 2, nullable: true })
  completionProgressPct: number | null;

  @Column({ name: 'status', type: 'varchar', length: 16, nullable: true })
  status: string | null;
}
