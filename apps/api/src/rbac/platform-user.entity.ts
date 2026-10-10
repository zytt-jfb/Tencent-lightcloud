import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * 新基线用户（biz_users）
 * 基线：01 §3 / 02 §2 —— 四类默认角色 + 账户级调整；
 * 地市用户永久绑定单一地市；账号停用立即禁止登录并使旧会话失效。
 * 与旧 users 表并存，M2 起服务层切换到本表。
 */
@Entity('biz_users')
export class PlatformUserEntity {
  /** 系统内部 UUID */
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  /** 登录账号，全局唯一 */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  username: string;

  /** 密码安全摘要（仅保存摘要，不可逆） */
  @Column({ name: 'password_hash', type: 'varchar', length: 255, select: false })
  passwordHash: string;

  /** 四类角色之一（PlatformRole） */
  @Index()
  @Column({ name: 'role_code', type: 'varchar', length: 32 })
  roleCode: string;

  /** 显示名称 */
  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** 地市用户永久绑定的地市 UUID；其他角色可为空 */
  @Index()
  @Column({ name: 'city_id', type: 'varchar', length: 36, nullable: true })
  cityId: string | null;

  /** 状态：enabled / disabled（停用立即失效） */
  @Column({ type: 'varchar', length: 16, default: 'enabled' })
  status: string;

  /** 会话失效版本号：停用/重置密码时递增 */
  @Column({ name: 'auth_version', type: 'int', default: 1 })
  authVersion: number;

  /** 敏感订单数据范围：full / masked（基线 01 §10.3） */
  @Column({ name: 'sensitive_order_scope', type: 'varchar', length: 16, default: 'masked' })
  sensitiveOrderScope: string;

  /** 首次登录是否必须改密 */
  @Column({ name: 'must_change_password', type: 'boolean', default: false })
  mustChangePassword: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
