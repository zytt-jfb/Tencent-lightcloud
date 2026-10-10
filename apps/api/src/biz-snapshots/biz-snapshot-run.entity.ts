import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export type SnapshotStatus = 'building' | 'ready' | 'failed';

/**
 * 快照运行表：每次预计算生成一条记录。
 * 同一 asOf 仅允许一个运行任务（uk_snapshot_run_asof 唯一约束 + 导入触发时的任务锁/幂等键）。
 * 生成期间状态为 building，完整计算并校验成功后改为 ready；失败标记 failed。
 */
@Entity('biz_snapshot_runs')
export class BizSnapshotRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'as_of', type: 'date' })
  asOf: string;

  @Column({ name: 'status', type: 'varchar', length: 16, default: 'building' })
  status: SnapshotStatus;

  /** 触发来源：'manual' = 手动（顶部"更新数据"/系统设置"立即更新"）；'auto' = 定时自动更新。便于审计 */
  @Column({ name: 'source', type: 'varchar', length: 16, nullable: true })
  source: 'manual' | 'auto' | null;

  @Column({ name: 'started_at', type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  startedAt: Date;

  @Column({ name: 'finished_at', type: 'datetime', nullable: true })
  finishedAt: Date | null;

  /** 触发快照时的数据版本水印（订单/线下完工/成本导入批次号等），用于可重算与审计 */
  @Column({ name: 'source_watermark', type: 'varchar', length: 128, nullable: true })
  sourceWatermark: string | null;

  @Column({ name: 'schema_version', type: 'varchar', length: 32, default: 'v1' })
  schemaVersion: string;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
