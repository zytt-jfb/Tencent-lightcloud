import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * 导出任务实体
 * 对应 DDL export_jobs 表
 */
@Entity('export_jobs')
export class ExportJobEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'operator_user_id', type: 'bigint' })
  operatorUserId: number;

  @Column({ name: 'export_mode', type: 'varchar', length: 32 })
  exportMode: string;

  @Column({ name: 'scope_type', type: 'varchar', length: 32 })
  scopeType: string;

  @Column({ name: 'city_id', type: 'bigint', nullable: true })
  cityId: number | null;

  @Column({ name: 'report_year', type: 'int' })
  reportYear: number;

  @Column({ name: 'belong_month', type: 'tinyint', nullable: true })
  belongMonth: number | null;

  @Column({ name: 'snapshot_range', type: 'varchar', length: 32, nullable: true })
  snapshotRange: string | null;

  @Column({ type: 'varchar', length: 32 })
  status: string;

  @Column({ name: 'file_url', type: 'varchar', length: 500, nullable: true })
  fileUrl: string | null;

  @Column({ name: 'expires_at', type: 'datetime', nullable: true })
  expiresAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
