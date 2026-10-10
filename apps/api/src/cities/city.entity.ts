import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * 城市实体
 *
 * 对应 DDL cities 表 — 城市主数据
 *
 * 业务含义：
 * - 每个城市对应一个经营单元
 * - 城市用户 (city_user) 绑定到某个 city_id
 * - 合同按城市分配（contract_city_allocations）
 */
@Entity('cities')
export class CityEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  @Column({ type: 'varchar', length: 50, nullable: true })
  code: string | null;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;
  @Column({ name: 'is_deleted', type: 'tinyint', width: 1, default: 0 })
  isDeleted: number;

  @Column({ name: 'deleted_at', type: 'datetime', nullable: true })
  deletedAt: Date | null;


  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
