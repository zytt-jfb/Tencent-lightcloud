import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Unique } from 'typeorm';

/**
 * 费用月度填报行实体
 * 对应 DDL report_cost_monthly_rows 表
 *
 * 唯一约束: package_id + month_no + cost_category_code
 * （F-01 纠偏令 IMP-1：与 001 DDL uk_cost_rows_pkg_month_cat 完全一致）
 */
@Entity('report_cost_monthly_rows')
@Unique('uk_cost_rows_pkg_month_cat', ['packageId', 'monthNo', 'costCategoryCode'])
export class CostMonthRowEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'package_id', type: 'bigint' })
  packageId: number;

  @Column({ name: 'month_no', type: 'tinyint' })
  monthNo: number;

  @Column({ name: 'cost_category_code', type: 'varchar', length: 50 })
  costCategoryCode: string;

  @Column({ type: 'decimal', precision: 18, scale: 2, default: 0 })
  amount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
