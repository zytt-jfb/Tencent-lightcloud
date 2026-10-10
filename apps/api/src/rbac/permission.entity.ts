import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * 权限点实体（biz_permissions）
 * 基线：01 §3.1 / 06 §11 —— 权限按"模块—页面—操作"三级组织；
 * 服务端与前端使用同一权限编码；菜单隐藏不是安全边界。
 */
@Entity('biz_permissions')
@Index('uk_biz_permission_code', ['code'], { unique: true })
export class PermissionEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  /** 权限编码（如 operation.contract.create / operation.order.upload），唯一 */
  @Column({ type: 'varchar', length: 128 })
  code: string;

  /** 权限名称（如"新增合同"） */
  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** 所属模块 UUID（biz_modules） */
  @Column({ name: 'module_id', type: 'varchar', length: 36 })
  moduleId: string;

  /** 操作类型：read / write / approve / manage */
  @Column({ type: 'varchar', length: 16 })
  action: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
