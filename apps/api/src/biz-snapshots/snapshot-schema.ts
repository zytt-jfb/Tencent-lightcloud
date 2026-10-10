/**
 * 经营分析快照表 DDL（幂等，可重复执行）。
 *
 * 与 apps/api/snapshot-tables.sql 一一对应；生产环境 TypeORM synchronize=false，
 * 因此在 BizSnapshotService.onModuleInit 中执行本脚本建表（仅新增表，不删不覆盖既有数据）。
 *
 * 注意：若 prod 已存在同名的旧结构表，需要按 snapshot-tables.sql 顶部注释单独 ALTER 补列；
 * 当前 prod 无任何 biz_snapshot_* 表，CREATE TABLE IF NOT EXISTS 会直接以最新结构建表（含 source 列）。
 */
export const SNAPSHOT_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS biz_snapshot_runs (
  id VARCHAR(36) PRIMARY KEY,
  as_of DATE NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'building',
  source VARCHAR(16) NULL,
  started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at DATETIME NULL,
  source_watermark VARCHAR(128) NULL,
  schema_version VARCHAR(32) NOT NULL DEFAULT 'v1',
  error_message TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_snapshot_run_asof (as_of)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS biz_snapshot_registry (
  id VARCHAR(36) PRIMARY KEY,
  current_snapshot_id VARCHAR(36) NULL,
  current_as_of DATE NULL,
  last_successful_at DATETIME NULL,
  status VARCHAR(16) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS biz_snapshot_metrics (
  id VARCHAR(36) PRIMARY KEY,
  snapshot_id VARCHAR(36) NOT NULL,
  period_type VARCHAR(16) NOT NULL,
  period_key VARCHAR(16) NOT NULL,
  province_id VARCHAR(36) NULL,
  city_id VARCHAR(36) NULL,
  contract_count INT NOT NULL DEFAULT 0,
  contract_amount_fen BIGINT NOT NULL DEFAULT 0,
  completion_fen BIGINT NOT NULL DEFAULT 0,
  order_completion_fen BIGINT NOT NULL DEFAULT 0,
  offline_completion_fen BIGINT NOT NULL DEFAULT 0,
  cost_fen BIGINT NOT NULL DEFAULT 0,
  gross_profit_fen BIGINT NOT NULL DEFAULT 0,
  net_profit_fen BIGINT NOT NULL DEFAULT 0,
  UNIQUE KEY uk_snapshot_metric (snapshot_id, period_type, period_key, province_id, city_id),
  KEY idx_snapshot_metric_snapshot (snapshot_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS biz_snapshot_alerts (
  id VARCHAR(36) PRIMARY KEY,
  snapshot_id VARCHAR(36) NOT NULL,
  contract_id VARCHAR(36) NOT NULL,
  province_id VARCHAR(36) NULL,
  city_id VARCHAR(36) NULL,
  contract_no VARCHAR(64) NULL,
  contract_name VARCHAR(255) NULL,
  alert_type VARCHAR(32) NOT NULL,
  end_date DATE NULL,
  contract_amount_fen BIGINT NULL,
  completion_fen BIGINT NULL,
  completion_progress_pct DECIMAL(7,2) NULL,
  status VARCHAR(16) NULL,
  KEY idx_snapshot_alert_snapshot (snapshot_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS biz_snapshot_contracts (
  id VARCHAR(36) PRIMARY KEY,
  snapshot_id VARCHAR(36) NOT NULL,
  contract_id VARCHAR(36) NOT NULL,
  province_id VARCHAR(36) NULL,
  city_id VARCHAR(36) NOT NULL,
  contract_amount_fen BIGINT NOT NULL DEFAULT 0,
  quota_fen BIGINT NOT NULL DEFAULT 0,
  completion_fen BIGINT NOT NULL DEFAULT 0,
  is_expired_at_asof TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uk_snapshot_contract (snapshot_id, contract_id, city_id),
  KEY idx_snapshot_contract_snapshot (snapshot_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS biz_snapshot_overruns (
  id VARCHAR(36) PRIMARY KEY,
  snapshot_id VARCHAR(36) NOT NULL,
  type VARCHAR(16) NOT NULL,
  contract_id VARCHAR(36) NULL,
  province_id VARCHAR(36) NULL,
  city_id VARCHAR(36) NULL,
  contract_no VARCHAR(64) NULL,
  contract_name VARCHAR(255) NULL,
  city_name VARCHAR(128) NULL,
  completion_fen BIGINT NOT NULL DEFAULT 0,
  quota_fen BIGINT NOT NULL DEFAULT 0,
  overrun_fen BIGINT NOT NULL DEFAULT 0,
  KEY idx_snapshot_overrun_snapshot (snapshot_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS biz_snapshot_overrun_periods (
  id VARCHAR(36) PRIMARY KEY,
  snapshot_id VARCHAR(36) NOT NULL,
  period_type VARCHAR(16) NOT NULL,
  period_key VARCHAR(16) NOT NULL,
  type VARCHAR(16) NOT NULL,
  contract_id VARCHAR(36) NULL,
  province_id VARCHAR(36) NULL,
  city_id VARCHAR(36) NULL,
  contract_no VARCHAR(64) NULL,
  contract_name VARCHAR(255) NULL,
  city_name VARCHAR(128) NULL,
  completion_fen BIGINT NOT NULL DEFAULT 0,
  quota_fen BIGINT NOT NULL DEFAULT 0,
  overrun_fen BIGINT NOT NULL DEFAULT 0,
  KEY idx_snapshot_overrun_period_snapshot (snapshot_id),
  KEY idx_snapshot_overrun_period_pk (snapshot_id, period_type, period_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS biz_snapshot_contract_ledger (
  id VARCHAR(36) PRIMARY KEY,
  snapshot_id VARCHAR(36) NOT NULL,
  contract_id VARCHAR(36) NOT NULL,
  contract_no VARCHAR(64) NULL,
  contract_name VARCHAR(255) NULL,
  tax_inclusive_amount_fen BIGINT NOT NULL DEFAULT 0,
  province_id VARCHAR(36) NULL,
  status VARCHAR(32) NULL,
  signed_date DATE NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  source_upload_record_id VARCHAR(36) NULL,
  cumulative_completion_fen BIGINT NOT NULL DEFAULT 0,
  completion_progress_pct DECIMAL(7,2) NULL,
  KEY idx_snapshot_ledger_snapshot (snapshot_id),
  KEY idx_snapshot_ledger_contract (contract_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];
