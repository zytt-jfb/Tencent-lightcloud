import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * 用户数据范围（biz_user_data_scopes）
 * 基线：01 §3.3 / 02 §5 —— 功能权限与数据范围分离；
 * super_admin 全部省份并可跨省汇总；admin 默认全部省份但一次只查看单一省份；
 * 地市用户范围必须来自数据库绑定的 city_id，不信任 URL/请求体/前端状态。
 * province_id 为空表示全部省份；city_id 为空表示该省份全部地市。
 */
@Entity('biz_user_data_scopes')
@Index('idx_biz_user_scope_user', ['userId'])
@Index('uk_biz_user_scope_province_city', ['userId', 'provinceId', 'cityId'], { unique: true })
export class UserDataScopeEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  /** 用户 UUID（biz_users） */
  @Column({ name: 'user_id', type: 'varchar', length: 36 })
  userId: string;

  /** 省份 UUID（biz_provinces）；空=全部省份 */
  @Column({ name: 'province_id', type: 'varchar', length: 36, nullable: true })
  provinceId: string | null;

  /** 地市 UUID（biz_cities）；空=该省全部地市 */
  @Column({ name: 'city_id', type: 'varchar', length: 36, nullable: true })
  cityId: string | null;

  /** 范围类型：all / province / city（冗余快捷字段，用于快速判定） */
  @Column({ name: 'scope_type', type: 'varchar', length: 16, default: 'city' })
  scopeType: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
