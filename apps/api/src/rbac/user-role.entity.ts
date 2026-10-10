import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** 用户与角色的多对多绑定。角色决定功能权限，数据范围由 UserScopeGrantEntity 单独决定。 */
@Entity('biz_user_roles')
@Index('idx_biz_user_role_user', ['userId'])
@Index('uk_biz_user_role', ['userId', 'roleCode'], { unique: true })
export class UserRoleEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ name: 'user_id', type: 'varchar', length: 36 })
  userId: string;

  @Column({ name: 'role_code', type: 'varchar', length: 32 })
  roleCode: string;

  @Column({ name: 'is_primary', type: 'boolean', default: false })
  isPrimary: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
