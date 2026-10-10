import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * 月度快照实体
 * 对应 DDL month_snapshots 表
 *
 * 核心：提交时生成不可变快照，summary_json / contract_rows_json 等字段
 * 存储该月度完整填报数据
 *
 * 唯一约束: package_id + belong_month
 */
@Entity('month_snapshots')
export class MonthSnapshotEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'package_id', type: 'bigint' })
  packageId: number;

  @Column({ name: 'city_id', type: 'bigint' })
  cityId: number;

  @Column({ name: 'report_year', type: 'int' })
  reportYear: number;

  @Column({ name: 'belong_month', type: 'tinyint' })
  belongMonth: number;

  @Column({ name: 'actual_submited_at', type: 'datetime' })
  actualSubmittedAt: Date;

  @Column({ name: 'is_overdue', type: 'tinyint', width: 1, default: 0 })
  isOverdue: number;

  @Column({ name: 'summary_json', type: 'json' })
  summaryJson: unknown;

  @Column({ name: 'contract_rows_json', type: 'json' })
  contractRowsJson: unknown;

  @Column({ name: 'cost_rows_json', type: 'json' })
  costRowsJson: unknown;

  @Column({ name: 'maintenance_rows_json', type: 'json', nullable: true })
  maintenanceRowsJson: unknown | null;

  @Column({ name: 'created_by', type: 'bigint' })
  createdBy: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
