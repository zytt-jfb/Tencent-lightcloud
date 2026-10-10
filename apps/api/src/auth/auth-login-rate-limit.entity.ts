import { Entity, Column, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * 登录限流哈希桶
 * 对应 009_production_governance.sql 的 auth_login_rate_limits 表（无 created_at，仅 updated_at）。
 * 只存储 HMAC 哈希，不保存原始 subject（用户名/openid/code/token）。
 */
@Entity('auth_login_rate_limits')
export class AuthLoginRateLimitEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'route_key', type: 'varchar', length: 32 })
  routeKey: string;

  @Column({ name: 'subject_hash', type: 'varchar', length: 64 })
  subjectHash: string;

  @Column({ name: 'window_started_at', type: 'datetime' })
  windowStartedAt: Date;

  @Column({ name: 'attempt_count', type: 'int', default: 0 })
  attemptCount: number;

  @Column({ name: 'blocked_until', type: 'datetime', nullable: true })
  blockedUntil: Date | null;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
