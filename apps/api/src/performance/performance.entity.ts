import { Column, CreateDateColumn, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('biz_performance_record')
@Index('uk_perf_batch_supplier_org', ['batchId', 'supplier', 'organization'], { unique: true })
@Index('idx_perf_org', ['organization'])
export class PerformanceRecordEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 }) id: string;
  @Column({ name: 'batch_id', type: 'varchar', length: 36 }) batchId: string;
  @Column({ name: 'assessment_year', type: 'int' }) assessmentYear: number;
  @Column({ name: 'supplier', type: 'varchar', length: 200 }) supplier: string;
  @Column({ name: 'organization', type: 'varchar', length: 200 }) organization: string;
  @Column({ name: 'city', type: 'varchar', length: 160, nullable: true }) city: string | null;
  @Column({ name: 'region', type: 'varchar', length: 160, nullable: true }) region: string | null;
  @Column({ name: 'score_1', type: 'decimal', precision: 8, scale: 3, nullable: true }) score1: number | null;
  @Column({ name: 'score_2', type: 'decimal', precision: 8, scale: 3, nullable: true }) score2: number | null;
  @Column({ name: 'score_3', type: 'decimal', precision: 8, scale: 3, nullable: true }) score3: number | null;
  @Column({ name: 'score_4', type: 'decimal', precision: 8, scale: 3, nullable: true }) score4: number | null;
  @Column({ name: 'score_5', type: 'decimal', precision: 8, scale: 3, nullable: true }) score5: number | null;
  @Column({ name: 'score_6', type: 'decimal', precision: 8, scale: 3, nullable: true }) score6: number | null;
  @Column({ name: 'score_7', type: 'decimal', precision: 8, scale: 3, nullable: true }) score7: number | null;
  @Column({ name: 'score_8', type: 'decimal', precision: 8, scale: 3, nullable: true }) score8: number | null;
  @Column({ name: 'score_9', type: 'decimal', precision: 8, scale: 3, nullable: true }) score9: number | null;
  @Column({ name: 'score_10', type: 'decimal', precision: 8, scale: 3, nullable: true }) score10: number | null;
  @Column({ name: 'score_11', type: 'decimal', precision: 8, scale: 3, nullable: true }) score11: number | null;
  @Column({ name: 'score_12', type: 'decimal', precision: 8, scale: 3, nullable: true }) score12: number | null;
  @CreateDateColumn({ name: 'created_at', type: 'datetime' }) createdAt: Date;
  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' }) updatedAt: Date;
}

@Entity('biz_performance_batch')
export class PerformanceBatchEntity {
  @PrimaryColumn({ type: 'varchar', length: 36 }) id: string;
  @Column({ type: 'varchar', length: 255 }) filename: string;
  @Column({ name: 'uploaded_by', type: 'varchar', length: 36 }) uploadedBy: string;
  @Column({ name: 'total_rows', type: 'int', default: 0 }) totalRows: number;
  @Column({ type: 'varchar', length: 20, default: 'active' }) status: string;
  @CreateDateColumn({ name: 'uploaded_at', type: 'datetime' }) uploadedAt: Date;
}
