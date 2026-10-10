import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * 合同城市经营测算指标实体
 * 对应 DDL contract_city_business_metrics 表
 *
 * 约束:
 * - contract_city_allocation_id 唯一（一条 allocation 只对应一条 metrics）
 * - 所有金额字段默认 0
 * - remark / source_city_name 可空
 */
@Entity('contract_city_business_metrics')
export class ContractCityBusinessMetricEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'contract_city_allocation_id', type: 'bigint', unique: true })
  contractCityAllocationId: number;

  @Column({ name: 'estimated_order_amount_2026', type: 'decimal', precision: 18, scale: 2, default: 0 })
  estimatedOrderAmount2026: number;

  @Column({ name: 'estimated_income_amount_2026', type: 'decimal', precision: 18, scale: 2, default: 0 })
  estimatedIncomeAmount2026: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  remark: string | null;

  @Column({ name: 'source_city_name', type: 'varchar', length: 100, nullable: true })
  sourceCityName: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
