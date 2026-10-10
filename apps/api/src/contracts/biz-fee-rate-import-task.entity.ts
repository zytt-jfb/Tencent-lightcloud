import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * 管理费率批量导入任务（新增表 biz_fee_rate_import_tasks）
 * 背景：合同+地市+生效月份维度的费率量大，需要"先解析预览、再确认写入"的两步流程，
 *      且任务状态与失败明细必须可追踪（不允许出现半批次且不可追踪的数据）。
 * 关键规则：
 *  - 第一步（preview）只解析校验并落本表 + 行明细，状态为 queued，不写 biz_contract_fee_rates；
 *  - 第二步（confirm）在同一个事务内写入费率并重算订单，失败整批回滚并落失败明细；
 *  - 状态：queued 排队中 / processing 处理中 / completed 已完成 /
 *          partial_failed 部分失败 / failed 失败；
 *  - 审计字段只保存业务摘要（文件名、SHA256、数量、影响订单数、失败原因摘要），
 *    严禁保存密码、JWT、数据库连接等敏感信息。
 */
export const FEE_RATE_IMPORT_STATUS = {
  QUEUED: 'queued',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  PARTIAL_FAILED: 'partial_failed',
  FAILED: 'failed',
} as const;
export type FeeRateImportStatus = (typeof FEE_RATE_IMPORT_STATUS)[keyof typeof FEE_RATE_IMPORT_STATUS];

@Entity('biz_fee_rate_import_tasks')
@Index('idx_biz_fee_rate_task_operator', ['operatorUserId'])
@Index('idx_biz_fee_rate_task_created', ['createdAt'])
export class BizFeeRateImportTaskEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  /** 操作人 UUID（biz_users） */
  @Column({ name: 'operator_user_id', type: 'varchar', length: 36 })
  operatorUserId: string;

  /** 导入文件名（仅文件名，不含路径） */
  @Column({ name: 'file_name', type: 'varchar', length: 255 })
  fileName: string;

  /** 文件 SHA256（审计：同一文件重复导入可识别） */
  @Column({ name: 'file_hash', type: 'varchar', length: 64 })
  fileHash: string;

  /** 任务状态：queued / processing / completed / partial_failed / failed */
  @Column({ type: 'varchar', length: 24, default: FEE_RATE_IMPORT_STATUS.QUEUED })
  status: string;

  /** 解析总行数（不含表头，不含完全空白行） */
  @Column({ name: 'total_rows', type: 'int', default: 0 })
  totalRows: number;

  /** 可新增数量 */
  @Column({ name: 'new_count', type: 'int', default: 0 })
  newCount: number;

  /** 将覆盖数量 */
  @Column({ name: 'overwrite_count', type: 'int', default: 0 })
  overwriteCount: number;

  /** 错误数量（无法写入） */
  @Column({ name: 'error_count', type: 'int', default: 0 })
  errorCount: number;

  /** 跳过数量（已存在且未允许覆盖、或费率一致无需变更） */
  @Column({ name: 'skip_count', type: 'int', default: 0 })
  skipCount: number;

  /** 预计/实际受影响订单行数 */
  @Column({ name: 'affected_order_count', type: 'int', default: 0 })
  affectedOrderCount: number;

  /** 预计/实际受影响订单金额（分） */
  @Column({ name: 'affected_amount_fen', type: 'bigint', default: 0 })
  affectedAmountFen: number;

  /** 是否触发订单重算（0/1） */
  @Column({ name: 'recalculated', type: 'boolean', default: false })
  recalculated: boolean;

  /** 失败原因摘要（审计用，最长 1000 字符，不含堆栈与敏感信息） */
  @Column({ name: 'error_summary', type: 'varchar', length: 1000, nullable: true })
  errorSummary: string | null;

  /** 预览明细快照（JSON 字符串：供确认步骤复核，不含敏感信息） */
  @Column({ name: 'payload_json', type: 'json', nullable: true })
  payloadJson: string | null;

  /** 执行结果快照（JSON 字符串：写入数量、重算数量、失败原因） */
  @Column({ name: 'result_json', type: 'json', nullable: true })
  resultJson: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  /** 用户点击"确认导入"的时间 */
  @Column({ name: 'confirmed_at', type: 'datetime', nullable: true })
  confirmedAt: Date | null;

  /** 任务终态时间（completed / partial_failed / failed） */
  @Column({ name: 'finished_at', type: 'datetime', nullable: true })
  finishedAt: Date | null;
}
