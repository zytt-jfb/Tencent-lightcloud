import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * 通用模块快照：每个业务模块一行一天（module_code + as_of 唯一）。
 * payload_json 只存"首屏所需"（汇总指标 + 前 N 条列表 + 图表点），不存全量，
 * 否则单行会膨胀到几百 MB 且无法用作首屏加速。
 */
@Entity('biz_module_snapshot')
export class BizModuleSnapshotEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 })
  id: string;

  @Column({ name: 'module_code', type: 'varchar', length: 64 })
  moduleCode: string;

  @Column({ name: 'as_of', type: 'date' })
  asOf: string;

  @Column({ type: 'varchar', length: 16, default: 'ready' })
  status: string;

  @Column({ name: 'payload_json', type: 'longtext' })
  payloadJson: string;

  @Column({ name: 'row_count', type: 'int', default: 0 })
  rowCount: number;

  @Column({ name: 'size_bytes', type: 'int', default: 0 })
  sizeBytes: number;

  @Column({ name: 'build_ms', type: 'int', nullable: true })
  buildMs: number | null;

  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage: string | null;

  @Column({ name: 'built_at', type: 'datetime' })
  builtAt: Date;
}
