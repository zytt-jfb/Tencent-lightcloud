import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * 汇总重算任务（新基线 biz_recalc_tasks）
 * 基线：07 §6.3 / 08 —— super_admin/admin 手工重算；
 * 默认只重算失败涉及的月份/地市/合同，全库重算必须二次确认。
 */
@Entity('biz_recalc_tasks')
@Index('idx_biz_recalc_status', ['status'])
export class BizRecalcTaskEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  /** 范围类型：failed_only / full */
  @Column({ name: 'scope_type', type: 'varchar', length: 16 })
  scopeType: string;

  /** 范围描述（failed_only 时列出失败范围；full 时"全库"） */
  @Column({ name: 'scope_desc', type: 'varchar', length: 1000, nullable: true })
  scopeDesc: string | null;

  /** 状态：pending / running / done / failed */
  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: string;

  /** 发起人 UUID */
  @Column({ name: 'requested_by', type: 'varchar', length: 36 })
  requestedBy: string;

  /** 发起时间 */
  @Column({ name: 'requested_at', type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  requestedAt: Date;

  /** 开始时间 */
  @Column({ name: 'started_at', type: 'datetime', nullable: true })
  startedAt: Date | null;

  /** 完成时间 */
  @Column({ name: 'finished_at', type: 'datetime', nullable: true })
  finishedAt: Date | null;

  /** 失败原因（failed 时记录） */
  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
