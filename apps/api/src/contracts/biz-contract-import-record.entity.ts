import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('biz_contract_import_records')
@Index('idx_biz_contract_import_record_uploaded', ['uploadedAt'])
@Index('idx_biz_contract_import_record_uploader', ['uploadedBy'])
export class BizContractImportRecordEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ type: 'varchar', length: 255 })
  filename: string;

  @Index({ unique: true })
  @Column({ name: 'file_hash', type: 'varchar', length: 64 })
  fileHash: string;

  @Column({ type: 'varchar', length: 16, default: 'parsing' })
  status: 'parsing' | 'imported' | 'failed';

  @Column({ name: 'sheet_count', type: 'int', default: 0 })
  sheetCount: number;

  @Column({ name: 'total_rows', type: 'int', default: 0 })
  totalRows: number;

  @Column({ name: 'valid_rows', type: 'int', default: 0 })
  validRows: number;

  @Column({ name: 'review_rows', type: 'int', default: 0 })
  reviewRows: number;

  @Column({ name: 'uploaded_by', type: 'varchar', length: 36 })
  uploadedBy: string;

  @Column({ name: 'data_scope_json', type: 'text', nullable: true })
  dataScopeJson: string | null;

  @Column({ name: 'completed_at', type: 'datetime', nullable: true })
  completedAt: Date | null;

  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason: string | null;

  @CreateDateColumn({ name: 'uploaded_at', type: 'datetime' })
  uploadedAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
