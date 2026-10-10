import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

/**
 * 提醒日志实体
 * 对应 DDL reminder_logs 表
 */
@Entity('reminder_logs')
export class ReminderLogEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'city_id', type: 'bigint' })
  cityId: number;

  @Column({ name: 'report_year', type: 'int' })
  reportYear: number;

  @Column({ name: 'belong_month', type: 'tinyint' })
  belongMonth: number;

  @Column({ name: 'trigger_type', type: 'varchar', length: 32 })
  triggerType: string;

  @Column({ name: 'recipient_user_id', type: 'bigint' })
  recipientUserId: number;

  @Column({ name: 'sender_user_id', type: 'bigint', nullable: true })
  senderUserId: number | null;

  @Column({ type: 'varchar', length: 32 })
  status: string;

  @Column({ name: 'sent_at', type: 'datetime', nullable: true })
  sentAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
