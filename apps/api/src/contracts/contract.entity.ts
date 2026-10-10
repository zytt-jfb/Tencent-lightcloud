import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { SoftDeleteFlag } from '@biz-reporting/shared-types';

/**
 * 合同实体
 * 对应 DDL contracts 表
 *
 * 重要: is_deleted 字段实现软删除，已删除合同不影响已有快照
 */
@Entity('contracts')
export class ContractEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'contract_code', type: 'varchar', length: 100, unique: true })
  contractCode: string;

  @Column({ name: 'contract_name', type: 'varchar', length: 255 })
  contractName: string;

  @Column({ name: 'contract_amount', type: 'decimal', precision: 18, scale: 2, default: 0 })
  contractAmount: number;

  @Column({ type: 'decimal', precision: 8, scale: 4, default: 0 })
  rate: number;

  @Column({ name: 'accumulated_order_amount', type: 'decimal', precision: 18, scale: 2, default: 0 })
  accumulatedOrderAmount: number;

  @Column({ name: 'accumulated_invoice_amount', type: 'decimal', precision: 18, scale: 2, default: 0 })
  accumulatedInvoiceAmount: number;

  @Column({ name: 'sign_date', type: 'date', nullable: true })
  signDate: Date | null;

  @Column({ name: 'expire_date', type: 'date', nullable: true })
  expireDate: Date | null;

  @Column({ name: 'is_deleted', type: 'tinyint', width: 1, default: SoftDeleteFlag.NOT_DELETED })
  isDeleted: SoftDeleteFlag;

  @Column({ name: 'deleted_at', type: 'datetime', nullable: true })
  deletedAt: Date | null;

  @Column({ name: 'created_by', type: 'bigint' })
  createdBy: number;

  @Column({ name: 'updated_by', type: 'bigint' })
  updatedBy: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
