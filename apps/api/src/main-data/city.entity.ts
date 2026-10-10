import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * 经营单位标准字典（兼容表名 biz_cities）
 * 基线：01 §3.3 / 07 TABLE 3 —— 地市归属省份，同名地市通过省份 + UUID 区分；
 * 订单以"省份 + 地市"共同映射，不能只按地市名称匹配。
 */
@Entity('biz_cities')
@Index('idx_biz_cities_province', ['provinceId'])
@Index('uk_biz_cities_province_name', ['provinceId', 'name'], { unique: true })
export class CityEntity {
  /** 系统内部 UUID（对普通用户不可见） */
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  /** 所属省份 UUID（合同只归属一个省份，只能分配到该省地市） */
  @Column({ name: 'province_id', type: 'varchar', length: 36 })
  provinceId: string;

  /** 省内标准编码（如 370100），同省份内唯一 */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32 })
  code: string;

  /** 标准地市名称（如"济南市"） */
  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** city=普通地市；province_branch=省级直属经营单位 */
  @Column({ name: 'unit_type', type: 'varchar', length: 32, default: 'city' })
  unitType: 'city' | 'province_branch';

  /** 状态：active / disabled */
  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
