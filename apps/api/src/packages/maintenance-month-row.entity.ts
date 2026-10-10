import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Unique } from 'typeorm';

/**
 * 维保月度填报行实体
 * 对应 DDL report_maintenance_monthly_rows 表
 *
 * 按城市配置启用（city_config.enable_maintenance = 1 时显示）
 * 唯一约束: package_id + month_no
 * （F-01 纠偏令 IMP-1：与 001 DDL uk_maintenance_rows_pkg_month 完全一致）
 */
@Entity('report_maintenance_monthly_rows')
@Unique('uk_maintenance_rows_pkg_month', ['packageId', 'monthNo'])
export class MaintenanceMonthRowEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'package_id', type: 'bigint' })
  packageId: number;

  @Column({ name: 'month_no', type: 'tinyint' })
  monthNo: number;

  @Column({ name: 'invoice_total_prev_year', type: 'decimal', precision: 18, scale: 2, default: 0 })
  invoiceTotalPrevYear: number;

  @Column({ name: 'invoice_month_count_prev_year', type: 'int', default: 0 })
  invoiceMonthCountPrevYear: number;

  @Column({ name: 'invoice_total_current_year', type: 'decimal', precision: 18, scale: 2, default: 0 })
  invoiceTotalCurrentYear: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
