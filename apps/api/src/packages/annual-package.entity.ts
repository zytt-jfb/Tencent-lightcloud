import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Unique } from 'typeorm';
import { PackageStatus } from '@biz-reporting/shared-types';

/**
 * 年度报表包实体
 * 对应 DDL annual_report_packages 表
 *
 * 核心约束: city_id × report_year 唯一
 * 状态流转: draft ↔ submitted（见 PACKAGE_STATUS_TRANSITIONS）
 */
@Entity('annual_report_packages')
@Unique('uk_packages_city_year', ['cityId', 'reportYear'])
export class AnnualPackageEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'city_id', type: 'bigint' })
  cityId: number;

  @Column({ name: 'report_year', type: 'int' })
  reportYear: number;

  @Column({ type: 'varchar', length: 32, default: PackageStatus.DRAFT })
  status: PackageStatus;

  @Column({ name: 'last_updated_by', type: 'bigint', nullable: true })
  lastUpdatedBy: number | null;

  @Column({ name: 'last_updated_at', type: 'datetime', nullable: true })
  lastUpdatedAt: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
