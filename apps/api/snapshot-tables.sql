-- 经营分析预计算快照表（幂等，可重复执行）
-- 仅新增表/索引，不删除、不覆盖既有数据。在 prod 执行前需业务确认。
-- 与 apps/api/src/biz-snapshots/*.entity.ts 字段一一对应。

CREATE TABLE IF NOT EXISTS biz_snapshot_runs (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 已存在 prod 表需补列（本脚本为幂等 CREATE，不自动 ALTER；上线前按此补列）：
-- ALTER TABLE biz_snapshot_runs ADD COLUMN source VARCHAR(16) NULL AFTER status;

CREATE TABLE IF NOT EXISTS biz_snapshot_registry (
  id VARCHAR(36) PRIMARY KEY,
  current_snapshot_id VARCHAR(36) NULL,
  current_as_of DATE NULL,
  last_successful_at DATETIME NULL,
  status VARCHAR(16) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS biz_snapshot_metrics (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS biz_snapshot_alerts (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS biz_snapshot_contracts (
  id VARCHAR(36) PRIMARY KEY,
  snapshot_id VARCHAR(36) NOT NULL,
  contract_id VARCHAR(36) NOT NULL,
  province_id VARCHAR(36) NULL,
  city_id VARCHAR(36) NOT NULL,
  contract_amount_fen BIGINT NOT NULL DEFAULT 0,
  quota_fen BIGINT NOT NULL DEFAULT 0,
  is_expired_at_asof TINYINT(1) NOT NULL DEFAULT 0,
  UNIQUE KEY uk_snapshot_contract (snapshot_id, contract_id, city_id),
  KEY idx_snapshot_contract_snapshot (snapshot_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS biz_snapshot_overruns (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 期间超额快照（新增）：支持按 period_type/period_key 过滤，使超额清单真正响应年度/月度筛选。
-- period_type: 'month' | 'current'；period_key: 'YYYY-MM' | 'current'；type: 'contract' | 'city'
CREATE TABLE IF NOT EXISTS biz_snapshot_overrun_periods (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 合同台账快照（新增，"一合同一行"）：与经营分析快照同一构建任务/事务生成并切换，供合同概览列表读取。
-- 区别于 biz_snapshot_contracts（合同×经营单位分配粒度），本表直接提供累计完工金额与完工进度。
CREATE TABLE IF NOT EXISTS biz_snapshot_contract_ledger (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
