import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * 重算任务实体
 * 对应 DDL recalc_tasks 表
 */
@Entity('recalc_tasks')
export class RecalcTaskEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ name: 'task_type', type: 'varchar', length: 32 })
  taskType: string;

  @Column({ name: 'related_import_job_id', type: 'bigint', nullable: true })
  relatedImportJobId: number | null;

  @Column({ type: 'varchar', length: 32 })
  status: string;

  @Column({ name: 'scope_json', type: 'json' })
  scopeJson: Record<string, unknown>;

  @Column({ name: 'error_message', type: 'varchar', length: 1000, nullable: true })
  errorMessage: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
