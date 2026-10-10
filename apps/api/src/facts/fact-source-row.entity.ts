import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('fact_source_rows')
@Index('uk_fact_source_batch_row', ['importBatchId', 'sheetName', 'rowNumber'], { unique: true })
export class FactSourceRowEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'import_batch_id', type: 'bigint' })
  importBatchId: number;

  @Column({ name: 'sheet_name', type: 'varchar', length: 255 })
  sheetName: string;

  @Column({ name: 'row_number', type: 'int' })
  rowNumber: number;

  @Column({ name: 'row_hash', type: 'varchar', length: 64 })
  rowHash: string;

  @Column({ name: 'business_key', type: 'varchar', length: 512, nullable: true })
  businessKey: string | null;

  @Column({ name: 'raw_json', type: 'json' })
  rawJson: Record<string, unknown>;

  @Column({ name: 'normalized_json', type: 'json', nullable: true })
  normalizedJson: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 32 })
  status: 'valid' | 'warning' | 'invalid' | 'written';

  @Column({ name: 'errors_json', type: 'json', nullable: true })
  errorsJson: unknown;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
