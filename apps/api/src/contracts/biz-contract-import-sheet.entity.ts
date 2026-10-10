import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('biz_contract_import_sheets')
@Index('uk_biz_contract_import_sheet_position', ['importRecordId', 'sheetIndex'], { unique: true })
export class BizContractImportSheetEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ name: 'import_record_id', type: 'varchar', length: 36 })
  importRecordId: string;

  @Column({ name: 'sheet_index', type: 'int' })
  sheetIndex: number;

  @Column({ name: 'sheet_name', type: 'varchar', length: 255 })
  sheetName: string;

  @Column({ name: 'start_row', type: 'int' })
  startRow: number;

  @Column({ name: 'start_col', type: 'int' })
  startCol: number;

  @Column({ name: 'row_count', type: 'int' })
  rowCount: number;

  @Column({ name: 'column_count', type: 'int' })
  columnCount: number;

  @Column({ name: 'header_row_no', type: 'int', nullable: true })
  headerRowNo: number | null;

  @Column({ name: 'headers_json', type: 'json', nullable: true })
  headersJson: string[] | null;

  @Column({ name: 'is_contract_sheet', type: 'boolean', default: false })
  isContractSheet: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
