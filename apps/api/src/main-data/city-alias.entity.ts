import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * 地市别名映射（新基线 biz_city_aliases）
 * 基线：07 TABLE 3 —— 标准名称修改后保留旧名称；订单上传仍要求预设标准映射成功，
 * 不在导入过程中做模糊匹配或自动创建行政区域。
 */
@Entity('biz_city_aliases')
@Index('uk_biz_city_alias', ['cityId', 'alias'], { unique: true })
export class CityAliasEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  /** 地市 UUID */
  @Column({ name: 'city_id', type: 'varchar', length: 36 })
  cityId: string;

  /** 旧名称/别名 */
  @Column({ type: 'varchar', length: 100 })
  alias: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
