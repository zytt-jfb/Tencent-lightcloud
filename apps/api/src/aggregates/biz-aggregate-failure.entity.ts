import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * 汇总异常（新基线 biz_aggregate_failures）
 * 基线：01 §5.6 / 07 TABLE 7 —— 汇总失败不删除明细、不自动重试，
 * 生成异常记录并通知 super_admin/admin/指定技术负责人。
 */
@Entity('biz_aggregate_failures')
@Index('idx_biz_agg_failure_status', ['status'])
@Index('idx_biz_agg_failure_scope', ['businessObjectType', 'businessObjectId'])
export class BizAggregateFailureEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  /** 业务对象类型（order_batch / offline_completion / cost_entry / contract） */
  @Column({ name: 'business_object_type', type: 'varchar', length: 64 })
  businessObjectType: string;

  /** 业务对象 UUID */
  @Column({ name: 'business_object_id', type: 'varchar', length: 36 })
  businessObjectId: string;

  /** 影响范围（如"2026-05 济南、合同X"；供人工重算定位） */
  @Column({ name: 'scope_desc', type: 'varchar', length: 500, nullable: true })
  scopeDesc: string | null;

  /** 错误信息（不含敏感字段） */
  @Column({ type: 'text', nullable: true })
  error: string | null;

  /** 状态：open / recalculated */
  @Column({ type: 'varchar', length: 16, default: 'open' })
  status: string;

  /** 首次发生时间 */
  @Column({ name: 'first_at', type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  firstAt: Date;

  /** 最后发生时间 */
  @Column({ name: 'last_at', type: 'datetime', nullable: true })
  lastAt: Date | null;

  /** 人工重算完成时间 */
  @Column({ name: 'recalculated_at', type: 'datetime', nullable: true })
  recalculatedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
