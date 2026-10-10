import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 合同跨地市分配实体
 * 对应 DDL contract_city_allocations 表
 *
 * 约束: contract_id + city_id 唯一
 */
@Entity('contract_city_allocations')
export class AllocationEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'contract_id', type: 'bigint' })
  contractId: number;

  @Column({ name: 'city_id', type: 'bigint' })
  cityId: number;

  @Column({ name: 'city_contract_amount', type: 'decimal', precision: 18, scale: 2, default: 0 })
  cityContractAmount: number;

  @Column({ type: 'decimal', precision: 8, scale: 4, default: 0 })
  rate: number;

  @Column({ name: 'accumulated_order_amount', type: 'decimal', precision: 18, scale: 2, default: 0 })
  accumulatedOrderAmount: number;

  @Column({ name: 'accumulated_invoice_amount', type: 'decimal', precision: 18, scale: 2, default: 0 })
  accumulatedInvoiceAmount: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
