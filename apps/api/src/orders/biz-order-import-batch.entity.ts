import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * 订单导入批次（新基线 biz_order_import_batches）
 * 基线：01 §5 / 04 §4 / 07 TABLE 5
 * 关键规则：
 *  - 上传者仅限 super_admin + admin；仅普通 .xlsx，单文件 ≤50MB、≤20 万行、单工作表；
 *  - 上传操作即视为导入确认，无内容审核；
 *  - 文件哈希 + 文件内最大下单时间 共同识别重复文件（两者均相同才阻止）；
 *  - 请求幂等键（idempotency_key）阻止网络重试产生第二套业务行；
 *  - 批次状态：parsing → imported / failed；imported → voided（仅 super_admin 作废/恢复）；
 *  - 失败批次只保留元数据 + 错误报告，不保存失败文件原始行。
 */
@Entity('biz_order_import_batches')
@Index('uk_biz_order_batch_idempotency', ['idempotencyKey'], { unique: true })
@Index('uk_biz_order_batch_fingerprint', ['fileHash', 'maxOrderTime'], { unique: true })
@Index('idx_biz_order_batch_uploader', ['uploadedBy'])
export class BizOrderImportBatchEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  /** 原文件名（仅展示） */
  @Column({ type: 'varchar', length: 255 })
  filename: string;

  /** 文件 SHA-256（重复文件控制技术指纹，不提供原文件还原） */
  @Column({ name: 'file_hash', type: 'varchar', length: 64 })
  fileHash: string;

  /** 文件内最大下单时间（重复文件控制第二指纹） */
  @Column({ name: 'max_order_time', type: 'datetime', nullable: true })
  maxOrderTime: Date | null;

  /** 请求幂等键（网络重试返回原批次结果，不重复写入） */
  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey: string;

  /** 状态：parsing / imported / failed / voided（OrderBatchStatus） */
  @Column({ type: 'varchar', length: 16, default: 'parsing' })
  status: string;

  /** 文件总行数（不含表头） */
  @Column({ name: 'total_rows', type: 'int', default: 0 })
  totalRows: number;

  /** 入账行数（imported 后 = totalRows） */
  @Column({ name: 'imported_rows', type: 'int', default: 0 })
  importedRows: number;

  /** 上传人 UUID（biz_users） */
  @Column({ name: 'uploaded_by', type: 'varchar', length: 36 })
  uploadedBy: string;

  /** 上传时间 */
  @Column({ name: 'uploaded_at', type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  uploadedAt: Date;

  /** 失败原因（failed 时记录，用于错误报告） */
  @Column({ name: 'failure_reason', type: 'text', nullable: true })
  failureReason: string | null;

  /** 临时文件路径（异步任务结束后删除；异常残留由启动清理/运维回收） */
  @Column({ name: 'temp_file_path', type: 'varchar', length: 500, nullable: true })
  tempFilePath: string | null;

  /** 上传时数据范围快照（JSON：{roleCode,scopeType,provinceIds,cityId}；行级范围校验依据） */
  @Column({ name: 'data_scope_json', type: 'varchar', length: 500, nullable: true })
  dataScopeJson: string | null;

  /** 修正批次来源；普通上传为空 */
  @Column({ name: 'source_batch_id', type: 'varchar', length: 36, nullable: true })
  sourceBatchId: string | null;

  /** normal=普通上传；correction=失败订单修正上传 */
  @Column({ name: 'batch_purpose', type: 'varchar', length: 16, default: 'normal' })
  batchPurpose: 'normal' | 'correction';

  @Column({ name: 'lifecycle_status', type: 'varchar', length: 16, default: 'historical' })
  lifecycleStatus: 'current' | 'historical';

  /** 作废人 UUID */
  @Column({ name: 'voided_by', type: 'varchar', length: 36, nullable: true })
  voidedBy: string | null;

  /** 作废时间 */
  @Column({ name: 'voided_at', type: 'datetime', nullable: true })
  voidedAt: Date | null;

  /** 作废原因（必填） */
  @Column({ name: 'void_reason', type: 'varchar', length: 255, nullable: true })
  voidReason: string | null;

  /** 恢复时间（super_admin 恢复后记录） */
  @Column({ name: 'restored_at', type: 'datetime', nullable: true })
  restoredAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
