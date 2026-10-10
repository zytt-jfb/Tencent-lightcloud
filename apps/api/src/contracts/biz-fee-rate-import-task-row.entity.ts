import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

/**
 * 管理费率批量导入任务行明细（新增表 biz_fee_rate_import_task_rows）
 * 关键规则：
 *  - 每一行 Excel 数据对应一条行明细，记录解析结果与最终写入结果；
 *  - outcome：new 新增 / overwrite 覆盖 / skip 跳过 / error 错误；
 *  - 覆盖必须记录原费率（prev_rate_bp）与新费率，便于审计与回滚排查；
 *  - 合同、地市一律以系统内部 UUID 为准，不依赖名称匹配。
 */
export const FEE_RATE_IMPORT_ROW_OUTCOME = {
  NEW: 'new',
  OVERWRITE: 'overwrite',
  SKIP: 'skip',
  ERROR: 'error',
} as const;
export type FeeRateImportRowOutcome = (typeof FEE_RATE_IMPORT_ROW_OUTCOME)[keyof typeof FEE_RATE_IMPORT_ROW_OUTCOME];

@Entity('biz_fee_rate_import_task_rows')
@Index('idx_biz_fee_rate_row_task', ['taskId'])
@Index('idx_biz_fee_rate_row_combo', ['contractId', 'cityId'])
export class BizFeeRateImportTaskRowEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  /** 所属任务 UUID */
  @Column({ name: 'task_id', type: 'varchar', length: 36 })
  taskId: string;

  /** Excel 行号（表头为 1，数据从 2 开始） */
  @Column({ name: 'row_no', type: 'int' })
  rowNo: number;

  /** 合同 UUID（无法识别时为 NULL） */
  @Column({ name: 'contract_id', type: 'varchar', length: 36, nullable: true })
  contractId: string | null;

  /** 经营单位 UUID（无法识别时为 NULL） */
  @Column({ name: 'city_id', type: 'varchar', length: 36, nullable: true })
  cityId: string | null;

  /** 生效月份 'YYYY-MM' */
  @Column({ name: 'effective_month', type: 'varchar', length: 7, nullable: true })
  effectiveMonth: string | null;

  /** 新费率（整数基点） */
  @Column({ name: 'rate_bp', type: 'int', nullable: true })
  rateBp: number | null;

  /** 覆盖前的原费率（整数基点；仅 outcome=overwrite 时有值） */
  @Column({ name: 'prev_rate_bp', type: 'int', nullable: true })
  prevRateBp: number | null;

  /** 修改说明 */
  @Column({ name: 'change_reason', type: 'varchar', length: 255, nullable: true })
  changeReason: string | null;

  /** 解析/写入结果：new / overwrite / skip / error */
  @Column({ type: 'varchar', length: 16, default: FEE_RATE_IMPORT_ROW_OUTCOME.ERROR })
  outcome: string;

  /** 错误或跳过原因（成功为 NULL） */
  @Column({ type: 'text', nullable: true })
  message: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;
}
