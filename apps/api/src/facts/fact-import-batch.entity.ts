import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('fact_import_batches')
@Index('uk_fact_batch_city_kind_hash', ['cityId', 'factKind', 'fileSha256'], { unique: true })
@Index('idx_fact_batch_lifecycle', ['cityId', 'factKind', 'lifecycleStatus', 'createdAt'])
export class FactImportBatchEntity {
  @PrimaryGeneratedColumn() id: number;
  @Column({ name: 'fact_kind', type: 'varchar', length: 16 }) factKind: 'cost' | 'order';
  @Column({ name: 'template_type', type: 'varchar', length: 64 }) templateType: string;
  @Column({ name: 'city_id', type: 'bigint' }) cityId: number;
  @Column({ name: 'operator_user_id', type: 'bigint' }) operatorUserId: number;
  @Column({ name: 'source_file_name', type: 'varchar', length: 255 }) sourceFileName: string;
  @Column({ name: 'source_file_sha256', type: 'varchar', length: 64 }) fileSha256: string;
  @Column({ name: 'source_file_base64', type: 'text', nullable: true }) sourceFileBase64: string | null;
  @Column({ name: 'source_file_storage_key', type: 'varchar', length: 500, nullable: true }) sourceFileStorageKey: string | null;
  @Column({ name: 'source_file_size', type: 'bigint', nullable: true }) sourceFileSize: number | null;
  @Column({ name: 'source_file_stored_at', type: 'datetime', nullable: true }) sourceFileStoredAt: Date | null;
  @Column({ type: 'varchar', length: 32 }) status: 'processing' | 'completed' | 'failed';
  @Column({ name: 'lifecycle_status', type: 'varchar', length: 32, default: 'processing' })
  lifecycleStatus: 'processing' | 'current_effective' | 'effective_with_warning' | 'validation_failed';
  @Column({ name: 'total_rows', type: 'int', default: 0 }) totalRows: number;
  @Column({ name: 'success_rows', type: 'int', default: 0 }) successRows: number;
  @Column({ name: 'error_rows', type: 'int', default: 0 }) errorRows: number;
  @Column({ name: 'warning_count', type: 'int', default: 0 }) warningCount: number;
  @Column({ name: 'blocking_error_count', type: 'int', default: 0 }) blockingErrorCount: number;
  @Column({ name: 'error_summary_json', type: 'json', nullable: true }) errorSummaryJson: unknown;
  @Column({ name: 'result_summary_json', type: 'json', nullable: true }) resultSummaryJson: unknown;
  @Column({ name: 'completed_at', type: 'datetime', nullable: true }) completedAt: Date | null;
  @Column({ name: 'effective_at', type: 'datetime', nullable: true }) effectiveAt: Date | null;
  @CreateDateColumn({ name: 'created_at' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updatedAt: Date;
}
