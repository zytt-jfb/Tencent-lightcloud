import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * 成本分类字典（新基线 biz_cost_categories）
 * 基线：01 §7 / 07 TABLE 6 —— 成本分类必填，系统字典维护。
 * 种子数据（M1 迁移提供）：labor/utilities/fuel/entertainment/rent/reimbursement/other 等。
 */
@Entity('biz_cost_categories')
export class BizCostCategoryEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  /** 分类编码，唯一 */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 50 })
  code: string;

  /** 分类名称（如"人工成本"） */
  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** 状态：active / disabled */
  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: string;

  /** 排序号 */
  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
