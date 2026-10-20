import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * 后评估导入批次（工程管理 / 后评估管理）
 * 每次管理员上传 Excel 生成一条；status：parsed（已解析待确认）/ imported（已入库）/ failed（失败）
 * 明细行落 biz_assessment_record，batch_id 指向本表，删除批次即按 batch_id 回滚。
 */
@Entity('biz_assessment_batch')
@Index('idx_biz_assessment_batch_month', ['evalMonth'])
@Index('idx_biz_assessment_batch_status', ['status'])
export class AssessmentBatchEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ type: 'varchar', length: 255 })
  filename: string;

  @Column({ name: 'file_size', type: 'int', nullable: true })
  fileSize: number | null;

  /** 批次内唯一月份（YYYY-MM）；跨月批次为 NULL */
  @Column({ name: 'eval_month', type: 'char', length: 7, nullable: true })
  evalMonth: string | null;

  @Column({ name: 'total_rows', type: 'int', default: 0 })
  totalRows: number;

  @Column({ name: 'valid_rows', type: 'int', default: 0 })
  validRows: number;

  /** 同批次内业务键重复、被合并的行数 */
  @Column({ name: 'duplicate_rows', type: 'int', default: 0 })
  duplicateRows: number;

  @Column({ name: 'failed_rows', type: 'int', default: 0 })
  failedRows: number;

  @Column({ name: 'inserted_rows', type: 'int', default: 0 })
  insertedRows: number;

  @Column({ name: 'updated_rows', type: 'int', default: 0 })
  updatedRows: number;

  @Column({ type: 'varchar', length: 20, default: 'parsed' })
  status: string;

  /** 解析阶段的行级错误明细（最多保留 200 条） */
  @Column({ name: 'error_json', type: 'json', nullable: true })
  errorJson: object[] | null;

  @Column({ name: 'uploaded_by', type: 'varchar', length: 36 })
  uploadedBy: string;

  @Column({ name: 'uploaded_at', type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  uploadedAt: Date;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
