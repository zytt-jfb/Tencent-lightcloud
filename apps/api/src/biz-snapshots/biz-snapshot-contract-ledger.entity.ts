import { Entity, Column, PrimaryColumn, Index } from 'typeorm';

/**
 * 合同台账快照（新增）："一合同一行"，与经营分析快照在同一构建任务/事务中生成并切换。
 * 区别于 biz_snapshot_contracts（合同 × 经营单位分配粒度），本表用于合同概览列表，
 * 直接提供累计完工金额与完工进度，避免列表加载后再批量请求 bizContractsBatchProgress。
 */
@Entity({ name: 'biz_snapshot_contract_ledger' })
export class BizSnapshotContractLedgerEntity {
  @PrimaryColumn('varchar', { length: 36 })
  id: string;

  @Index()
  @Column('varchar', { name: 'snapshot_id', length: 36 })
  snapshotId: string;

  @Index()
  @Column('varchar', { name: 'contract_id', length: 36 })
  contractId: string;

  @Column('varchar', { name: 'contract_no', length: 64, nullable: true })
  contractNo: string | null;

  @Column('varchar', { name: 'contract_name', length: 255, nullable: true })
  contractName: string | null;

  @Column('bigint', { name: 'tax_inclusive_amount_fen', default: 0 })
  taxInclusiveAmountFen: number;

  @Column('varchar', { name: 'province_id', length: 36, nullable: true })
  provinceId: string | null;

  @Column('varchar', { name: 'status', length: 32, nullable: true })
  status: string | null;

  @Column('date', { name: 'signed_date', nullable: true })
  signedDate: string | null;

  @Column('date', { name: 'start_date', nullable: true })
  startDate: string | null;

  @Column('date', { name: 'end_date', nullable: true })
  endDate: string | null;

  @Column('varchar', { name: 'source_upload_record_id', length: 36, nullable: true })
  sourceUploadRecordId: string | null;

  @Column('bigint', { name: 'cumulative_completion_fen', default: 0 })
  cumulativeCompletionFen: number;

  @Column('decimal', { name: 'completion_progress_pct', precision: 7, scale: 2, nullable: true })
  completionProgressPct: number | null;
}
