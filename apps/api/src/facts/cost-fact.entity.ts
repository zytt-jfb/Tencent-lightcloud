import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('cost_facts')
@Index('idx_cost_facts_scope_period', ['cityId', 'periodYear', 'periodMonth'])
@Index('idx_cost_facts_contract', ['contractId'])
export class CostFactEntity {
  @PrimaryGeneratedColumn()
  id: number;
  @Column({ name: 'city_id', type: 'bigint' }) cityId: number;
  @Column({ name: 'contract_id', type: 'bigint' }) contractId: number;
  @Column({ name: 'occurred_on', type: 'date' }) occurredOn: string;
  @Column({ name: 'period_year', type: 'int' }) periodYear: number;
  @Column({ name: 'period_month', type: 'tinyint' }) periodMonth: number;
  @Column({ name: 'cost_category_code', type: 'varchar', length: 50 }) costCategoryCode: string;
  @Column({ name: 'cost_subtype', type: 'varchar', length: 100, nullable: true }) costSubtype: string | null;
  @Column({ type: 'varchar', length: 1000 }) description: string;
  @Column({ type: 'decimal', precision: 18, scale: 2 }) amount: number;
  @Column({ name: 'actual_spender', type: 'varchar', length: 100, nullable: true }) actualSpender: string | null;
  @Column({ name: 'advance_payer', type: 'varchar', length: 100, nullable: true }) advancePayer: string | null;
  @Column({ name: 'receipt_type', type: 'varchar', length: 100, nullable: true }) receiptType: string | null;
  @Column({ name: 'approval_number', type: 'varchar', length: 100, nullable: true }) approvalNumber: string | null;
  @Column({ name: 'approval_status', type: 'varchar', length: 100, nullable: true }) approvalStatus: string | null;
  @Column({ name: 'ding_talk_data_id', type: 'varchar', length: 128, nullable: true }) dingTalkDataId: string | null;
  @Column({ type: 'decimal', precision: 18, scale: 2, nullable: true }) mileage: number | null;
  @Column({ name: 'locations_json', type: 'json', nullable: true }) locationsJson: unknown;
  @Column({ name: 'attachments_json', type: 'json', nullable: true }) attachmentsJson: unknown;
  @Column({ name: 'raw_payload_json', type: 'json', nullable: true }) rawPayloadJson: unknown;
  @Column({ name: 'source_type', type: 'varchar', length: 64 }) sourceType: string;
  @Column({ name: 'import_batch_id', type: 'bigint', nullable: true }) importBatchId: number | null;
  @Column({ name: 'source_row_id', type: 'bigint', nullable: true }) sourceRowId: number | null;
  @Column({ name: 'reversed_fact_id', type: 'bigint', nullable: true }) reversedFactId: number | null;
  @Column({ name: 'is_reversed', type: 'tinyint', default: 0 }) isReversed: number;
  @Column({ name: 'version_no', type: 'int', default: 1 }) versionNo: number;
  @Column({ name: 'created_by', type: 'bigint' }) createdBy: number;
  @Column({ name: 'updated_by', type: 'bigint' }) updatedBy: number;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
