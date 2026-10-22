import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * 用户级偏好（每人一份的界面选择）
 *
 * 首个用途：工作台「待办事项」展示哪几类（pref_key = workbench.todo_keys）。
 * 用 (user_id, pref_key) 联合主键，同一个用户可存多份互不干扰的偏好；
 * pref_value 存 JSON 字符串——用 TEXT 而不是 JSON 列，读写时由 service 序列化，
 * 避免不同 MySQL 版本/驱动对 JSON 列的映射差异。
 *
 * 注意：偏好只影响展示，不参与授权。能选哪些项仍由权限决定。
 */
@Entity('biz_user_preferences')
export class BizUserPreferenceEntity {
  @PrimaryColumn({ name: 'user_id', type: 'varchar', length: 36 })
  userId: string;

  @PrimaryColumn({ name: 'pref_key', type: 'varchar', length: 64 })
  prefKey: string;

  /** JSON 字符串 */
  @Column({ name: 'pref_value', type: 'text' })
  prefValue: string;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
