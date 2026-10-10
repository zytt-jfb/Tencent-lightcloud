import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn, VersionColumn } from 'typeorm';

/**
 * 地市月度成本（新基线 biz_cost_entries）
 * 基线：01 §7 / 04 §6 / 07 TABLE 6
 * 关键规则：
 *  - 成本只能由地市用户上报本地市数据，管理员默认不能代录；
 *  - 成本只关联地市和业务月份，不关联合同；
 *  - 业务月份不得晚于当前月份；金额 >= 0（0 允许提交和审核但不改变指标）；
 *  - 同地市、同月份、同分类允许多条明细，系统自动汇总；
 *  - 状态机：draft/rejected → approved（提交即生效）；approved 可被授权管理员退回或作废；
 *  - 默认仅 super_admin 审核成本；可授权其他角色审核和作废；
 *  - 已通过成本不可直接修改，只能由授权角色作废后重新上报；作废必须填写原因。
 */
@Entity('biz_cost_entries')
@Index('idx_biz_cost_city_month', ['cityId', 'businessMonth'])
@Index('idx_biz_cost_status', ['status'])
export class BizCostEntryEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  /** 地市 UUID（服务端从认证账号绑定地市取得） */
  @Column({ name: 'city_id', type: 'varchar', length: 36 })
  cityId: string;

  /** 业务月份 'YYYY-MM'（不得晚于当前月份） */
  @Column({ name: 'business_month', type: 'varchar', length: 7 })
  businessMonth: string;

  /** 成本分类编码（biz_cost_categories.code，必填） */
  @Column({ name: 'category_code', type: 'varchar', length: 50 })
  categoryCode: string;

  /** 成本金额（分）；>=0，允许 0 */
  @Column({ name: 'amount_fen', type: 'bigint' })
  amountFen: number;

  /** 说明（可选） */
  @Column({ type: 'varchar', length: 500, nullable: true })
  description: string | null;

  /** 状态：draft / pending(历史兼容) / approved(已生效) / rejected(已退回) / voided */
  @Column({ type: 'varchar', length: 16, default: 'draft' })
  status: string;

  /** 提交人 UUID（地市用户） */
  @Column({ name: 'submitted_by', type: 'varchar', length: 36, nullable: true })
  submittedBy: string | null;

  /** 提交时间 */
  @Column({ name: 'submitted_at', type: 'datetime', nullable: true })
  submittedAt: Date | null;

  /** 审核人 UUID（默认 super_admin，可授权） */
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

  /** 并发版本号 */
  // 乐观锁版本（TypeORM @VersionColumn；列已在 010 迁移建立，无需新迁移）
  @VersionColumn({ name: 'version_no', type: 'int', default: 1 })
  versionNo: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
