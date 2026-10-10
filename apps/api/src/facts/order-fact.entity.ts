import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('order_facts')
@Index('idx_order_facts_scope_period', ['cityId', 'periodYear', 'periodMonth'])
@Index('idx_order_facts_contract', ['contractId'])
@Index('uk_order_fact_city_business_key', ['cityId', 'businessKey'], { unique: true })
export class OrderFactEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column({ name: 'city_id', type: 'bigint' }) cityId: number;
  @Column({ name: 'contract_id', type: 'bigint' }) contractId: number;
  @Column({ name: 'purchase_order_no', type: 'varchar', length: 160 }) purchaseOrderNo: string;
  @Column({ name: 'order_status', type: 'varchar', length: 100 }) orderStatus: string;
  @Column({ name: 'tax_inclusive_amount', type: 'decimal', precision: 18, scale: 2 }) taxInclusiveAmount: number;
  @Column({ name: 'material_name', type: 'varchar', length: 1000 }) materialName: string;
  @Column({ name: 'material_code', type: 'varchar', length: 160 }) materialCode: string;
  @Column({ name: 'project_code', type: 'varchar', length: 160, nullable: true }) projectCode: string | null;
  @Column({ name: 'project_name', type: 'varchar', length: 1000, nullable: true }) projectName: string | null;
  @Column({ name: 'site_code', type: 'varchar', length: 160, nullable: true }) siteCode: string | null;
  @Column({ name: 'site_name', type: 'varchar', length: 1000, nullable: true }) siteName: string | null;
  @Column({ name: 'ordered_at', type: 'datetime' }) orderedAt: Date;
  @Column({ name: 'period_year', type: 'int' }) periodYear: number;
  @Column({ name: 'period_month', type: 'tinyint' }) periodMonth: number;
  @Column({ name: 'receipt_status', type: 'varchar', length: 100, nullable: true }) receiptStatus: string | null;
  @Column({ name: 'source_type', type: 'varchar', length: 64 }) sourceType: string;
  @Column({ name: 'import_batch_id', type: 'bigint', nullable: true }) importBatchId: number | null;
  @Column({ name: 'source_row_id', type: 'bigint', nullable: true }) sourceRowId: number | null;
  @Column({ name: 'business_key', type: 'varchar', length: 512 }) businessKey: string;
  @Column({ name: 'is_reversal', type: 'tinyint', default: 0 }) isReversal: number;
  @Column({ name: 'is_reversed', type: 'tinyint', default: 0 }) isReversed: number;
  @Column({ name: 'reversed_fact_id', type: 'bigint', nullable: true }) reversedFactId: number | null;
  @Column({ name: 'raw_payload_json', type: 'json', nullable: true }) rawPayloadJson: unknown;
  @Column({ name: 'version_no', type: 'int', default: 1 }) versionNo: number;
  @Column({ name: 'created_by', type: 'bigint' }) createdBy: number;
  @Column({ name: 'updated_by', type: 'bigint' }) updatedBy: number;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
