import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

/**
 * 消息实体
 * 对应 DDL messages 表
 */
@Entity('messages')
export class MessageEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'user_id', type: 'bigint' })
  userId: number;

  @Column({ name: 'message_type', type: 'varchar', length: 50 })
  messageType: string;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  @Column({ type: 'varchar', length: 500 })
  summary: string;

  @Column({ name: 'payload_json', type: 'json', nullable: true })
  payloadJson: Record<string, unknown> | null;

  @Column({ name: 'is_read', type: 'tinyint', width: 1, default: 0 })
  isRead: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @Column({ name: 'read_at', type: 'datetime', nullable: true })
  readAt: Date | null;
}
