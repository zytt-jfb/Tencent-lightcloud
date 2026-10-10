import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * 合同-地市分配（新基线 biz_contract_city_allocations）
 * 基线：01 §4.5 / 03 / 04 §3 / 07 TABLE 4
 * 关键规则：
 *  - 一份合同可分配一个或多个地市，同合同地市唯一；
 *  - 各地市固定额度合计不得超过合同额，未分配部分为合同预留额度；
 *  - 生效后可调整额度，但不得降低到该地市已生效完工金额以下；
 *  - 取消分配仅 super_admin；历史数据保留，该地市禁止新增业务；
 *  - 订单/线下完工超额时仍保存真实数据，超额标识由服务层按累计净额计算。
 */
@Entity('biz_contract_city_allocations')
@Index('idx_biz_city_alloc_contract', ['contractId'])
@Index('idx_biz_city_alloc_city', ['cityId'])
@Index('uk_biz_city_alloc_contract_city', ['contractId', 'cityId'], { unique: true })
export class BizContractCityAllocationEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  /** 合同 UUID（biz_contracts） */
  @Column({ name: 'contract_id', type: 'varchar', length: 36 })
  contractId: string;

  /** 地市 UUID（biz_cities，必须属于合同所属省份） */
  @Column({ name: 'city_id', type: 'varchar', length: 36 })
  cityId: string;

  /** 固定地市额度（分）；各地市合计不得超过合同额 */
  @Column({ name: 'quota_fen', type: 'bigint' })
  quotaFen: number;

  /** 状态：active / cancelled */
  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: string;

  /** 分配生效时间 */
  @Column({ name: 'effective_at', type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  effectiveAt: Date;

  /** 取消时间（cancelled 时记录） */
  @Column({ name: 'cancelled_at', type: 'datetime', nullable: true })
  cancelledAt: Date | null;

  /** 版本号（分配并发编辑控制：后保存者收到"分配关系已变化"提示） */
  @Column({ name: 'version_no', type: 'int', default: 1 })
  versionNo: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
