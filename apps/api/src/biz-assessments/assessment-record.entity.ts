import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * 后评估事实表（工程管理 / 后评估管理）
 * - source=import：管理员 Excel 导入，粒度 项目 × 地市 × 供应商 × 月份，contract_id 可空
 * - source=offline：地市人员线下填报，必须关联合同（contract_id + eval_month）
 * - status：import 行固定 active；offline 行走 draft / submitted / returned / voided
 * - dedup_key：服务层归一化后拼出的业务键（唯一索引）。不用联合唯一索引的原因：
 *   MySQL 唯一索引对 NULL 不生效，而导入行的 city_id / contract_id 可能为空。
 */
@Entity('biz_assessment_record')
@Index('uk_biz_assessment_dedup', ['dedupKey'], { unique: true })
@Index('idx_biz_assessment_month', ['evalMonth'])
@Index('idx_biz_assessment_city_month', ['cityId', 'evalMonth'])
@Index('idx_biz_assessment_supplier', ['supplierName'])
@Index('idx_biz_assessment_batch', ['batchId'])
@Index('idx_biz_assessment_status', ['status'])
@Index('idx_biz_assessment_contract', ['contractId'])
@Index('idx_biz_assessment_source', ['source'])
export class AssessmentRecordEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  /** import / offline */
  @Column({ type: 'varchar', length: 16, default: 'import' })
  source: 'import' | 'offline';

  @Column({ name: 'batch_id', type: 'varchar', length: 36, nullable: true })
  batchId: string | null;

  /** 后评价月份 YYYY-MM */
  @Column({ name: 'eval_month', type: 'char', length: 7 })
  evalMonth: string;

  /** 采购项目名称（线下填报时用合同名称回填） */
  @Column({ name: 'project_name', type: 'varchar', length: 300, default: '' })
  projectName: string;

  @Column({ name: 'city_id', type: 'varchar', length: 36, nullable: true })
  cityId: string | null;

  /** 原始地市文本（烟台市分公司 / 山东省分公司 等），城市字典匹配失败时仍可展示 */
  @Column({ name: 'city_name', type: 'varchar', length: 160, default: '' })
  cityName: string;

  @Column({ name: 'province_id', type: 'varchar', length: 36, nullable: true })
  provinceId: string | null;

  @Column({ name: 'supplier_name', type: 'varchar', length: 200 })
  supplierName: string;

  @Column({ name: 'contract_id', type: 'varchar', length: 36, nullable: true })
  contractId: string | null;

  /** 合同编号快照（合同改名后仍可追溯） */
  @Column({ name: 'contract_no', type: 'varchar', length: 100, nullable: true })
  contractNo: string | null;

  /** 后评价分数 0-100 */
  @Column({ type: 'decimal', precision: 6, scale: 2 })
  score: number;

  /** 等级 A/B/C/D（当前留空，后续按规则计算） */
  @Column({ type: 'varchar', length: 4, nullable: true })
  grade: string | null;

  /** online / offline */
  @Column({ name: 'eval_method', type: 'varchar', length: 8, default: 'online' })
  evalMethod: 'online' | 'offline';

  /** 原始序号列，仅用于追溯 */
  @Column({ name: 'src_seq', type: 'int', nullable: true })
  srcSeq: number | null;

  /** 原始整行留痕（导入归一化会损失信息，出问题靠它回溯） */
  // json 列用 object 类型：既保留原始结构，又能在 TypeORM 的 DeepPartial 下正常赋值
  @Column({ name: 'raw_json', type: 'json', nullable: true })
  rawJson: object | null;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: 'active' | 'draft' | 'submitted' | 'returned' | 'voided';

  @Column({ name: 'dedup_key', type: 'varchar', length: 255 })
  dedupKey: string;

  @Column({ name: 'submitted_by', type: 'varchar', length: 36, nullable: true })
  submittedBy: string | null;

  @Column({ name: 'submitted_at', type: 'datetime', nullable: true })
  submittedAt: Date | null;

  @Column({ name: 'returned_by', type: 'varchar', length: 36, nullable: true })
  returnedBy: string | null;

  @Column({ name: 'returned_at', type: 'datetime', nullable: true })
  returnedAt: Date | null;

  @Column({ name: 'return_reason', type: 'varchar', length: 500, nullable: true })
  returnReason: string | null;

  @Column({ name: 'voided_by', type: 'varchar', length: 36, nullable: true })
  voidedBy: string | null;

  @Column({ name: 'voided_at', type: 'datetime', nullable: true })
  voidedAt: Date | null;

  @Column({ name: 'void_reason', type: 'varchar', length: 255, nullable: true })
  voidReason: string | null;

  @Column({ name: 'created_by', type: 'varchar', length: 36, nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @Column({ name: 'updated_by', type: 'varchar', length: 36, nullable: true })
  updatedBy: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
