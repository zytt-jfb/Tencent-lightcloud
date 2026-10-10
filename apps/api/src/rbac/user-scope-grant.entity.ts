import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export type UserScopeGrantType = 'all' | 'province' | 'city' | 'contract';

/** 用户数据范围授权。target_id 为空仅用于 all；其它类型指向对应业务对象。 */
@Entity('biz_user_scope_grants')
@Index('idx_biz_user_scope_grant_user', ['userId'])
@Index('idx_biz_user_scope_grant_target', ['scopeType', 'targetId'])
@Index('uk_biz_user_scope_grant', ['userId', 'scopeType', 'targetId', 'effect'], { unique: true })
export class UserScopeGrantEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ name: 'user_id', type: 'varchar', length: 36 })
  userId: string;

  @Column({ name: 'scope_type', type: 'varchar', length: 16 })
  scopeType: UserScopeGrantType;

  @Column({ name: 'target_id', type: 'varchar', length: 36, nullable: true })
  targetId: string | null;

  @Column({ type: 'varchar', length: 8, default: 'allow' })
  effect: 'allow' | 'deny';

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
