import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * 合同预警（新基线 biz_contract_alerts）
 * 基线：03 §7.3-7.4 / 07 TABLE 4
 * 预警类型：nearly_full（接近满额）、overfull（满额/超额）、expiring（即将到期）、expired（已到期）。
 * 预警随业务变更尝试回算；首发仅通过经营分析页与管理员待办展示，不发送外部通知。
 */
@Entity('biz_contract_alerts')
@Index('idx_biz_contract_alert_contract', ['contractId'])
@Index('idx_biz_contract_alert_type_status', ['alertType', 'currentStatus'])
export class BizContractAlertEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  /** 合同 UUID（biz_contracts） */
  @Column({ name: 'contract_id', type: 'varchar', length: 36 })
  contractId: string;

  /** 预警类型（ContractAlertType） */
  @Column({ name: 'alert_type', type: 'varchar', length: 24 })
  alertType: string;

  /** 首次触发时间 */
  @Column({ name: 'first_triggered_at', type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  firstTriggeredAt: Date;

  /** 最近触发时间 */
  @Column({ name: 'last_triggered_at', type: 'datetime', nullable: true })
  lastTriggeredAt: Date | null;

  /** 当前状态：active / resolved */
  @Column({ name: 'current_status', type: 'varchar', length: 16, default: 'active' })
  currentStatus: string;

  /** 解除时间（resolved 时记录） */
  @Column({ name: 'resolved_at', type: 'datetime', nullable: true })
  resolvedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
