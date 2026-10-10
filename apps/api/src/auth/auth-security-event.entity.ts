import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

/**
 * 登录安全审计事件
 * 对应 009_production_governance.sql 的 auth_security_events 表。
 * 不建立 user 外键：不存在账号的失败尝试也必须可记录。
 * 只存储 HMAC 哈希，不保存原始 subject / IP / code / token。
 */
@Entity('auth_security_events')
export class AuthSecurityEventEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'event_type', type: 'varchar', length: 32 })
  eventType: string;

  @Column({ name: 'outcome', type: 'varchar', length: 16 })
  outcome: string;

  @Column({ name: 'route_key', type: 'varchar', length: 32 })
  routeKey: string;

  @Column({ name: 'subject_hash', type: 'varchar', length: 64 })
  subjectHash: string;

  @Column({ name: 'ip_hash', type: 'varchar', length: 64 })
  ipHash: string;

  @Column({ name: 'user_id', type: 'bigint', nullable: true })
  userId: number | null;

  @Column({ name: 'city_id', type: 'bigint', nullable: true })
  cityId: number | null;

  @Column({ name: 'reason_code', type: 'varchar', length: 64 })
  reasonCode: string;

  @Column({ name: 'request_id', type: 'varchar', length: 64 })
  requestId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
