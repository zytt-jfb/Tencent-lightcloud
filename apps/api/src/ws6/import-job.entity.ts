import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * 导入任务实体
 * 对应 DDL import_jobs 表
 */
@Entity('import_jobs')
export class ImportJobEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'job_type', type: 'varchar', length: 32 })
  jobType: string;

  @Column({ name: 'operator_user_id', type: 'bigint' })
  operatorUserId: number;

  @Column({ name: 'city_id', type: 'bigint', nullable: true })
  cityId: number | null;

  @Column({ type: 'varchar', length: 32 })
  status: string;

  @Column({ name: 'source_file_url', type: 'varchar', length: 500 })
  sourceFileUrl: string;

  // D-01：旧 Base64 仅作 legacy 回退读取，select:false 避免列表/详情查询携带大字段。
  // SQLite does not support MySQL's longtext metadata; production DDL keeps longtext.
  @Column({ name: 'source_file_base64', type: 'text', nullable: true, select: false })
  sourceFileBase64: string | null;

  // ---- D-01/009 持久存储字段（migration 009_production_governance）----
  @Column({ name: 'source_file_storage_key', type: 'varchar', length: 500, nullable: true })
  sourceFileStorageKey: string | null;

  @Column({ name: 'source_file_sha256', type: 'varchar', length: 64, nullable: true })
  sourceFileSha256: string | null;

  @Column({ name: 'source_file_size', type: 'bigint', nullable: true })
  sourceFileSize: number | null;

  @Column({ name: 'source_file_stored_at', type: 'datetime', nullable: true })
  sourceFileStoredAt: Date | null;

  @Column({ name: 'attempt_count', type: 'int', default: 0 })
  attemptCount: number;

  @Column({ name: 'processing_started_at', type: 'datetime', nullable: true })
  processingStartedAt: Date | null;

  @Column({ name: 'failure_code', type: 'varchar', length: 64, nullable: true })
  failureCode: string | null;

  @Column({ name: 'source_file_name', type: 'varchar', length: 255, nullable: true })
  sourceFileName: string | null;

  @Column({ name: 'parsed_summary_json', type: 'json', nullable: true })
  parsedSummaryJson: Record<string, unknown> | null;

  @Column({ name: 'diff_summary_json', type: 'json', nullable: true })
  diffSummaryJson: Record<string, unknown> | null;

  @Column({ name: 'error_summary_json', type: 'json', nullable: true })
  errorSummaryJson: Record<string, unknown> | null;

  @Column({ name: 'confirmed_at', type: 'datetime', nullable: true })
  confirmedAt: Date | null;

  @Column({ name: 'report_year', type: 'int', nullable: true })
  reportYear: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
