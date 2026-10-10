import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * 站内消息（新基线 biz_messages）
 * 基线：01 §11 / 07 TABLE 7 —— 合同预警、待办、订单导入结果、汇总异常和权限变化；
 * 首发不接入企业微信/短信/邮件。
 */
@Entity('biz_messages')
@Index('idx_biz_message_recipient', ['recipientId', 'status'])
@Index('idx_biz_message_type', ['messageType'])
export class BizMessageEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  /** 接收人 UUID（biz_users） */
  @Column({ name: 'recipient_id', type: 'varchar', length: 36 })
  recipientId: string;

  /** 消息类型（BizMessageType） */
  @Column({ name: 'message_type', type: 'varchar', length: 32 })
  messageType: string;

  /** 关联业务对象 UUID（合同/批次/异常等） */
  @Column({ name: 'business_object_id', type: 'varchar', length: 36, nullable: true })
  businessObjectId: string | null;

  /** 消息内容 */
  @Column({ type: 'varchar', length: 1000 })
  content: string;

  /** 状态：unread / read */
  @Column({ type: 'varchar', length: 16, default: 'unread' })
  status: string;

  /** 发送时间（UTC 存储） */
  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
