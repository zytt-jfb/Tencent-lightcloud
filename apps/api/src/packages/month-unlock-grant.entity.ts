import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

/**
 * 月度解锁授权实体
 * 对应 DDL month_unlock_grants 表
 *
 * 管理员可对已提交/锁定月份发放临时解锁授权，
 * 允许城市用户在 expires_at 前重新编辑并重新提交
 */
@Entity('month_unlock_grants')
export class MonthUnlockGrantEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'package_id', type: 'bigint' })
  packageId: number;

  @Column({ name: 'month_no', type: 'tinyint' })
  monthNo: number;

  @Column({ name: 'expires_at', type: 'datetime' })
  expiresAt: Date;

  @Column({ name: 'granted_by', type: 'bigint' })
  grantedBy: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  reason: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
