import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * 角色-权限关联（biz_role_permissions）
 * 基线：02 §1 —— 角色默认权限；super_admin 默认拥有全部权限。
 */
@Entity('biz_role_permissions')
@Index('uk_biz_role_permission', ['roleId', 'permissionCode'], { unique: true })
export class RolePermissionEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  /** 角色 UUID（biz_roles） */
  @Column({ name: 'role_id', type: 'varchar', length: 36 })
  roleId: string;

  /** 权限编码（biz_permissions.code） */
  @Column({ name: 'permission_code', type: 'varchar', length: 128 })
  permissionCode: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
