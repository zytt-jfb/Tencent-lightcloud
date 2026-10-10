import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('biz_contract_source_rows')
@Index('uk_biz_contract_source_row_position', ['sheetId', 'sourceRowNo'], { unique: true })
@Index('idx_biz_contract_source_row_status', ['importRecordId', 'normalizationStatus'])
export class BizContractSourceRowEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ name: 'import_record_id', type: 'varchar', length: 36 })
  importRecordId: string;

  @Column({ name: 'sheet_id', type: 'varchar', length: 36 })
  sheetId: string;

  @Column({ name: 'source_row_no', type: 'int' })
  sourceRowNo: number;

  @Column({ name: 'row_kind', type: 'varchar', length: 16 })
  rowKind: 'header' | 'data' | 'blank';

  @Column({ name: 'cells_json', type: 'json' })
  cellsJson: string;

  @Column({ name: 'normalization_status', type: 'varchar', length: 16, default: 'archived' })
  normalizationStatus: 'archived' | 'valid' | 'needs_review';

  @Column({ name: 'normalization_message', type: 'text', nullable: true })
  normalizationMessage: string | null;

  @Column({ name: 'province_id', type: 'varchar', length: 36, nullable: true })
  provinceId: string | null;

  @Column({ name: 'city_id', type: 'varchar', length: 36, nullable: true })
  cityId: string | null;

  @Column({ name: 'contract_id', type: 'varchar', length: 36, nullable: true })
  contractId: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
