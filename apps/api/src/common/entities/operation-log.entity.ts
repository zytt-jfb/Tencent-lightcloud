import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, Index } from 'typeorm';

/**
 * 操作日志实体
 * 对应 DDL operation_logs 表
 *
 * 记录系统所有关键业务操作（提交、退回、解锁、导入、导出等），
 * 用于审计追踪和 Dashboard 统计
 */
@Entity('operation_logs')
export class OperationLogEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'operator_user_id', type: 'bigint' })
  operatorUserId: number;

  @Column({ name: 'operator_city_id', type: 'bigint', nullable: true })
  operatorCityId: number | null;

  @Column({ name: 'action_type', type: 'varchar', length: 64 })
  actionType: string;

  @Column({ name: 'target_type', type: 'varchar', length: 64 })
  targetType: string;

  @Column({ name: 'target_id', type: 'varchar', length: 128 })
  targetId: string;

  @Column({ name: 'summary_text', type: 'varchar', length: 1000 })
  summaryText: string;

  @Column({ name: 'before_data_json', type: 'json', nullable: true })
  beforeDataJson: unknown;

  @Column({ name: 'after_data_json', type: 'json', nullable: true })
  afterDataJson: unknown;

  @Column({ name: 'result_status', type: 'varchar', length: 32 })
  resultStatus: string;

  @Index('idx_operation_logs_created_at', ['createdAt'])
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
