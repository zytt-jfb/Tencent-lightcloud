import type { FactValidationIssue, FactVersionLifecycleStatus } from '@biz-reporting/shared-types';
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('fact_versions')
@Index('uk_fact_version', ['factType', 'factId', 'versionNo'], { unique: true })
@Index('idx_fact_version_scope_status', ['cityId', 'lifecycleStatus', 'createdAt'])
export class FactVersionEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column({ name: 'fact_type', type: 'varchar', length: 16 }) factType: 'cost' | 'order';
  @Column({ name: 'fact_id', type: 'bigint' }) factId: number;
  @Column({ name: 'city_id', type: 'bigint', nullable: true }) cityId: number | null;
  @Column({ name: 'contract_id', type: 'bigint', nullable: true }) contractId: number | null;
  @Column({ name: 'period_year', type: 'int', nullable: true }) periodYear: number | null;
  @Column({ name: 'period_month', type: 'tinyint', nullable: true }) periodMonth: number | null;
  @Column({ name: 'version_no', type: 'int' }) versionNo: number;
  @Column({ name: 'change_type', type: 'varchar', length: 32 }) changeType: 'create' | 'update' | 'reverse';
  @Column({ name: 'lifecycle_status', type: 'varchar', length: 32, default: 'current_effective' }) lifecycleStatus: FactVersionLifecycleStatus;
  @Column({ name: 'supersedes_version_id', type: 'bigint', nullable: true }) supersedesVersionId: number | null;
  @Column({ name: 'superseded_by_version_id', type: 'bigint', nullable: true }) supersededByVersionId: number | null;
  @Column({ name: 'before_data_json', type: 'json', nullable: true }) beforeDataJson: unknown;
  @Column({ name: 'after_data_json', type: 'json', nullable: true }) afterDataJson: unknown;
  @Column({ name: 'changed_fields_json', type: 'json', nullable: true }) changedFieldsJson: string[] | null;
  @Column({ name: 'warning_summary_json', type: 'json', nullable: true }) warningSummaryJson: FactValidationIssue[] | null;
  @Column({ type: 'varchar', length: 500 }) reason: string;
  @Column({ name: 'operator_user_id', type: 'bigint' }) operatorUserId: number;
  @Column({ name: 'source_type', type: 'varchar', length: 64 }) sourceType: string;
  @Column({ name: 'import_batch_id', type: 'bigint', nullable: true }) importBatchId: number | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
}
