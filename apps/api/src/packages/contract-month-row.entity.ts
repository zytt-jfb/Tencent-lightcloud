import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn, Unique } from 'typeorm';

/**
 * 合同月度填报行实体
 * 对应 DDL report_contract_monthly_rows 表
 *
 * 唯一约束: package_id + contract_code_snapshot + month_no
 * （F-01 纠偏令 IMP-1：与 001 DDL uk_contract_rows_pkg_code_month 完全一致）
 */
@Entity('report_contract_monthly_rows')
@Unique('uk_contract_rows_pkg_code_month', ['packageId', 'contractCodeSnapshot', 'monthNo'])
export class ContractMonthRowEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'package_id', type: 'bigint' })
  packageId: number;

  @Column({ name: 'contract_id', type: 'bigint', nullable: true })
  contractId: number | null;

  @Column({ name: 'contract_code_snapshot', type: 'varchar', length: 100 })
  contractCodeSnapshot: string;

  @Column({ name: 'contract_name_snapshot', type: 'varchar', length: 255 })
  contractNameSnapshot: string;

  @Column({ name: 'city_allocation_id', type: 'bigint', nullable: true })
  cityAllocationId: number | null;

  @Column({ name: 'month_no', type: 'tinyint' })
  monthNo: number;

  @Column({ name: 'completion_amount', type: 'decimal', precision: 18, scale: 2, default: 0 })
  completionAmount: number;

  @Column({ name: 'acceptance_amount', type: 'decimal', precision: 18, scale: 2, default: 0 })
  acceptanceAmount: number;

  @Column({ name: 'invoice_amount', type: 'decimal', precision: 18, scale: 2, nullable: true })
  invoiceAmount: number | null;

  @Column({ name: 'order_amount', type: 'decimal', precision: 18, scale: 2, nullable: true })
  orderAmount: number | null;

  @Column({ name: 'is_locked', type: 'tinyint', width: 1, default: 0 })
  isLocked: number;

  @Column({ name: 'lock_reason', type: 'varchar', length: 100, nullable: true })
  lockReason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
