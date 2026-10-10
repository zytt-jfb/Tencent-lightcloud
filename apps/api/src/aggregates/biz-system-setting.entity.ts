import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** 系统设置（迁移 014；到期预警阈值等配置） */
@Entity('biz_system_settings')
export class BizSystemSettingEntity {
  @PrimaryColumn({ name: 'id', type: 'varchar', length: 36 })
  id: string;

  @Column({ name: 'setting_key', type: 'varchar', length: 64, unique: true })
  settingKey: string;

  @Column({ name: 'setting_value', type: 'varchar', length: 255 })
  settingValue: string;

  @Column({ name: 'description', type: 'varchar', length: 255, nullable: true })
  description: string | null;

  @Column({ name: 'updated_by', type: 'varchar', length: 36, nullable: true })
  updatedBy: string | null;

  @CreateDateColumn({ name: 'updated_at', type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  updatedAt: Date;
}
