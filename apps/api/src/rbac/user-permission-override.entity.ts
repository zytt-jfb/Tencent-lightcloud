import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * 账户例外权限（biz_user_permission_overrides）
 * 基线：01 §3.1 / 02 §1 —— "角色默认权限 + 账户级调整"；
 * 与角色默认权限合并得到最终权限；effect=allow 显式授予、deny 显式拒绝。
 */
@Entity('biz_user_permission_overrides')
@Index('uk_biz_user_perm_override', ['userId', 'permissionCode'], { unique: true })
export class UserPermissionOverrideEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  /** 用户 UUID（biz_users） */
  @Column({ name: 'user_id', type: 'varchar', length: 36 })
  userId: string;

  /** 权限编码（biz_permissions.code） */
  @Column({ name: 'permission_code', type: 'varchar', length: 128 })
  permissionCode: string;

  /** allow / deny */
  @Column({ type: 'varchar', length: 8 })
  effect: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
