import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn, VersionColumn } from 'typeorm';

/**
 * 线下完工（新基线 biz_offline_completions）
 * 基线：01 §6 / 04 §5 / 07 TABLE 6
 * 关键规则：
 *  - 地市用户必须先选择一个已分配给本地市的合同，一条线下完工只关联一个合同；
 *  - 必填：合同、业务月份、完工金额、业务摘要；附件选填；金额禁止负数；
 *  - 金额为 0 只能保存草稿，不能提交审核（指标字典 2.2 取代基线简化的"0 可提交"）；
 *  - 业务月份不得为未来月份；
 *  - 状态机：draft → pending → approved / rejected；pending 可撤回草稿；approved 可作废（voided）；
 *  - 未审核通过不计入合同进度和利润；超额不阻止审核，通过后计入并生成两级超额标识；
 *  - 已通过记录不可直接修改，只能作废后新增；恢复已作废记录回到 pending 重新审批。
 */
@Entity('biz_offline_completions')
@Index('idx_biz_offline_contract', ['contractId'])
@Index('idx_biz_offline_city_month', ['cityId', 'businessMonth'])
@Index('idx_biz_offline_status', ['status'])
export class BizOfflineCompletionEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  /** 合同 UUID（必须已分配给本地市且允许上报） */
  @Column({ name: 'contract_id', type: 'varchar', length: 36 })
  contractId: string;

  /** 地市 UUID（服务端从认证账号绑定地市取得，不接受请求体覆盖） */
  @Column({ name: 'city_id', type: 'varchar', length: 36 })
  cityId: string;

  /** 业务月份 'YYYY-MM'（不得未来月份） */
  @Column({ name: 'business_month', type: 'varchar', length: 7 })
  businessMonth: string;

  /** 完工金额（分）；>=0，提交/审核必须 >0 */
  @Column({ name: 'amount_fen', type: 'bigint' })
  amountFen: number;

  /** 管理费率快照（基点，如 12.35% => 1235；提交时按 合同+地市+业务月份 固化，与费率历史解耦） */
  @Column({ name: 'fee_rate_snapshot_bp', type: 'int', nullable: true })
  feeRateSnapshotBp: number | null;

  /** 完工毛利（分）= amount_fen × fee_rate_snapshot_bp / 10000（提交时计算，审核通过后计入汇总） */
  @Column({ name: 'gross_profit_fen', type: 'bigint', default: 0 })
  grossProfitFen: number;

  /** 业务摘要（必填） */
  @Column({ type: 'varchar', length: 500 })
  summary: string;

  /** 附件引用（可选；不保存原始文件长期存储） */
  @Column({ name: 'attachment_ref', type: 'varchar', length: 255, nullable: true })
  attachmentRef: string | null;

  /** 状态：draft / pending / approved / rejected / voided */
  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status: string;

  /** 是否超过地市固定分配额度（按最新累计净额计算） */
  @Column({ name: 'city_overrun_flag', type: 'boolean', default: false })
  cityOverrunFlag: boolean;

  /** 是否超过合同总额 */
  @Column({ name: 'contract_overrun_flag', type: 'boolean', default: false })
  contractOverrunFlag: boolean;

  /** 提交人 UUID（地市用户） */
  @Column({ name: 'submitted_by', type: 'varchar', length: 36, nullable: true })
  submittedBy: string | null;

  /** 提交时间 */
  @Column({ name: 'submitted_at', type: 'datetime', nullable: true })
  submittedAt: Date | null;

  /** 审核人 UUID（super_admin/admin） */
  @Column({ name: 'reviewer_id', type: 'varchar', length: 36, nullable: true })
  reviewerId: string | null;

  /** 审核时间 */
  @Column({ name: 'reviewed_at', type: 'datetime', nullable: true })
  reviewedAt: Date | null;

  /** 审核意见（驳回必填原因） */
  @Column({ name: 'review_comment', type: 'varchar', length: 500, nullable: true })
  reviewComment: string | null;

  /** 作废人 UUID */
  @Column({ name: 'voided_by', type: 'varchar', length: 36, nullable: true })
  voidedBy: string | null;

  /** 作废时间 */
  @Column({ name: 'voided_at', type: 'datetime', nullable: true })
  voidedAt: Date | null;

  /** 作废原因（必填） */
  @Column({ name: 'void_reason', type: 'varchar', length: 255, nullable: true })
  voidReason: string | null;

  /** 并发版本号（每次审批重新校验合同状态和分配关系） */
  // 乐观锁版本（TypeORM @VersionColumn；列已在 010 迁移建立，无需新迁移）
  @VersionColumn({ name: 'version_no', type: 'int', default: 1 })
  versionNo: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
