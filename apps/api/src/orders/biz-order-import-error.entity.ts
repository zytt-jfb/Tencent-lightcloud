import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * 订单导入错误报告（新基线 biz_order_import_errors）
 * 基线：05 §2 / 07 TABLE 5 —— 失败批次用于生成错误报告，
 * 不保存失败文件原始行；错误提示/日志不得包含完整联系方式或详细地址。
 */
@Entity('biz_order_import_errors')
@Index('idx_biz_order_error_batch', ['batchId'])
export class BizOrderImportErrorEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  /** 失败批次 UUID（biz_order_import_batches） */
  @Column({ name: 'batch_id', type: 'varchar', length: 36 })
  batchId: string;

  /** 错误类型：structure / province / city / contract / allocation / time / amount / other */
  @Column({ name: 'error_type', type: 'varchar', length: 32 })
  errorType: string;

  /** 出错行号（可空：结构类错误可能无行号） */
  @Column({ name: 'row_no', type: 'int', nullable: true })
  rowNo: number | null;

  /** 出错字段（列名或标准化字段名） */
  @Column({ name: 'field', type: 'varchar', length: 100, nullable: true })
  field: string | null;

  /** 错误说明（不含完整敏感字段） */
  @Column({ type: 'text' })
  message: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
