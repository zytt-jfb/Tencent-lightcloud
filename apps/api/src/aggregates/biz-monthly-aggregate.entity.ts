import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * 月度汇总（新基线 biz_monthly_aggregates）
 * 基线：01 §9 / 03 / 07 TABLE 7
 * 关键规则：
 *  - 用于加速总览和分析；可由权威明细重建，不能反向覆盖明细；
 *  - 汇总失败保留明细、标记统计滞后（stale_flag），不自动重试；
 *  - 维度：省份+地市+合同+业务月份；city_id 为空=省级行，contract_id 为空=地市行；
 *  - 金额统一整数分；毛利润按"合同+地市+月份+有效费率"汇总后计算并四舍五入到分。
 */
@Entity('biz_monthly_aggregates')
@Index('uk_biz_agg_dim_month', ['provinceId', 'cityId', 'contractId', 'businessMonth'], { unique: true })
@Index('idx_biz_agg_city_month', ['cityId', 'businessMonth'])
@Index('idx_biz_agg_contract_month', ['contractId', 'businessMonth'])
export class BizMonthlyAggregateEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  /** 省份 UUID（biz_provinces） */
  @Column({ name: 'province_id', type: 'varchar', length: 36 })
  provinceId: string;

  /** 地市 UUID（biz_cities）；省级汇总行为空 */
  @Column({ name: 'city_id', type: 'varchar', length: 36, nullable: true })
  cityId: string | null;

  /** 合同 UUID（biz_contracts）；地市/省级汇总行为空 */
  @Column({ name: 'contract_id', type: 'varchar', length: 36, nullable: true })
  contractId: string | null;

  /** 业务月份 'YYYY-MM' */
  @Column({ name: 'business_month', type: 'varchar', length: 7 })
  businessMonth: string;

  /** 订单完工金额（分） */
  @Column({ name: 'order_completion_fen', type: 'bigint', default: 0 })
  orderCompletionFen: number;

  /** 已审核线下完工金额（分） */
  @Column({ name: 'offline_completion_fen', type: 'bigint', default: 0 })
  offlineCompletionFen: number;

  /** 毛利润（分） */
  @Column({ name: 'gross_profit_fen', type: 'bigint', default: 0 })
  grossProfitFen: number;

  /** 地市已审核成本（分）；不关联合同 */
  @Column({ name: 'cost_fen', type: 'bigint', default: 0 })
  costFen: number;

  /** 净利润（分）= 毛利润 − 成本（省级/地市行） */
  @Column({ name: 'net_profit_fen', type: 'bigint', default: 0 })
  netProfitFen: number;

  /** 统计滞后标记：true=明细已保存但汇总失败/待重算 */
  @Column({ name: 'stale_flag', type: 'boolean', default: false })
  staleFlag: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
