import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * 省份标准字典（新基线 biz_provinces）
 * 基线：01 §3.3 / 07 TABLE 3 —— 建立独立省份/地市两级行政区域字典，不得写死山东省。
 * 命名变更不改变 UUID，不破坏历史合同/订单/成本/权限关系。
 */
@Entity('biz_provinces')
export class ProvinceEntity {
  /** 系统内部 UUID（对普通用户不可见） */
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  /** 标准行政区编码（如 370000），全局唯一 */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32 })
  code: string;

  /** 标准省份名称，唯一（如"山东省"） */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** 状态：active / disabled */
  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
