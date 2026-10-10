import { Entity, Column, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 快照注册表（单例行）：当前生效快照指针。
 * 新快照 building -> ready 后，在事务内一次性更新 current_snapshot_id，
 * 实现"原子切换 + 旧快照兜底"（生成失败继续读上一版 ready 快照）。
 */
@Entity('biz_snapshot_registry')
export class BizSnapshotRegistryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'current_snapshot_id', type: 'uuid', nullable: true })
  currentSnapshotId: string | null;

  @Column({ name: 'current_as_of', type: 'date', nullable: true })
  currentAsOf: string | null;

  @Column({ name: 'last_successful_at', type: 'datetime', nullable: true })
  lastSuccessfulAt: Date | null;

  @Column({ name: 'status', type: 'varchar', length: 16, nullable: true })
  status: string | null;
}
