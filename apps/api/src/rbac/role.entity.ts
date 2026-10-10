import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * 角色实体（biz_roles）
 * 基线：01 §3 / 02 §2 —— 四类默认角色；super_admin 拥有全部权限且不可被其他账号修改/停用。
 */
@Entity('biz_roles')
export class RoleEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  /** 角色编码（PlatformRole：super_admin/admin/contract_manager/city_user），唯一 */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32 })
  code: string;

  /** 角色名称（如"超级管理员"） */
  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** 内置标记：true=不可删除的默认角色 */
  @Column({ name: 'is_builtin', type: 'boolean', default: false })
  isBuiltin: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
