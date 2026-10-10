import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { Role, UserStatus } from '@biz-reporting/shared-types';

/**
 * 用户实体
 * 对应 DDL users 表
 *
 * 双角色:
 * - system_admin: username + password_hash 非空, openid 为空
 * - city_user: openid 非空, 绑定 city_id
 */
@Entity('users')
export class UserEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 32 })
  role: Role;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ name: 'city_id', type: 'bigint', nullable: true })
  cityId: number | null;

  @Column({ type: 'varchar', length: 128, unique: true, nullable: true })
  openid: string | null;

  @Column({ type: 'varchar', length: 100, unique: true, nullable: true })
  username: string | null;

  @Column({ name: 'password_hash', type: 'varchar', length: 255, nullable: true, select: false })
  passwordHash: string | null;

  @Column({ type: 'varchar', length: 32, default: UserStatus.ENABLED })
  status: UserStatus;

  @Column({ name: 'auth_version', type: 'int', default: 1 })
  authVersion: number;

  @Column({ name: 'must_change_password', type: 'boolean', default: false })
  mustChangePassword: boolean;

  @Column({ name: 'register_at', type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  registerAt: Date;

  @Column({ name: 'last_login_at', type: 'datetime', nullable: true })
  lastLoginAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
