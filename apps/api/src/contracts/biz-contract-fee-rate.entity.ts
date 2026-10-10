import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * 合同-地市管理费率历史（新基线 biz_contract_fee_rates）
 * 基线：01 §4.6 / 03 §4.2 / 07 TABLE 4
 * 关键规则：
 *  - 管理费率按"合同 + 地市 + 生效月份"维护，同一合同在不同地市可采用不同费率；
 *  - 费率以整数基点保存（12.35% => 1235），必须 > 0% 且 ≤ 100%；
 *  - 新费率从生效月份当月起适用于新发生的订单和线下完工；
 *  - 历史完工继续使用其业务月份当时生效的费率，不按最新费率重算；
 *  - 修改费率必须填写生效月份（修改原因可选）。
 */
@Entity('biz_contract_fee_rates')
@Index('idx_biz_fee_rate_contract_city', ['contractId', 'cityId'])
@Index('uk_biz_fee_rate_contract_city_month', ['contractId', 'cityId', 'effectiveMonth'], { unique: true })
export class BizContractFeeRateEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  /** 合同 UUID（biz_contracts） */
  @Column({ name: 'contract_id', type: 'varchar', length: 36 })
  contractId: string;

  /** 地市 UUID（biz_cities） */
  @Column({ name: 'city_id', type: 'varchar', length: 36 })
  cityId: string;

  /** 生效月份 'YYYY-MM'；当月开始适用新费率 */
  @Column({ name: 'effective_month', type: 'varchar', length: 7 })
  effectiveMonth: string;

  /** 费率（整数基点：12.35% => 1235） */
  @Column({ name: 'rate_bp', type: 'int' })
  rateBp: number;

  /** 变更原因（可选） */
  @Column({ name: 'change_reason', type: 'varchar', length: 255, nullable: true })
  changeReason: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
