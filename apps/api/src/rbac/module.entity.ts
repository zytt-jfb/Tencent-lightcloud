import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * 模块实体（biz_modules）
 * 基线：01 §2 / 07 TABLE 3 —— 支持一级门户（工程管理/维护管理）与
 * 维护管理二级门户（经营管理/资产管理/人员管理）两层模块树。
 */
@Entity('biz_modules')
export class ModuleEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  /** 模块编码，唯一（如 engineering / maintenance / operation / asset / personnel） */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  code: string;

  /** 模块名称（如"工程管理"） */
  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** 模块层级：level1（一级门户） / level2（维护管理二级门户） */
  @Column({ type: 'varchar', length: 16 })
  level: string;

  /** 父模块 UUID（二级模块指向维护管理一级模块；一级模块为空） */
  @Column({ name: 'parent_id', type: 'varchar', length: 36, nullable: true })
  parentId: string | null;

  /** 排序号 */
  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder: number;

  /** 状态：active / disabled */
  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
