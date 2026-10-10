-- Production governance: forward-only compatibility extension.
-- Adds import-job storage/attempt metadata, login rate-limiting, and security audit events.
-- Existing migrations are immutable; apply only through scripts/db/migrate.mjs.
-- SQLite equivalent lives in scripts/db/migrate.mjs (applySqliteProductionGovernance).

ALTER TABLE import_jobs
  ADD COLUMN source_file_storage_key VARCHAR(500) NULL AFTER source_file_url,
  ADD COLUMN source_file_sha256 VARCHAR(64) NULL AFTER source_file_storage_key,
  ADD COLUMN source_file_size BIGINT NULL AFTER source_file_sha256,
  ADD COLUMN source_file_stored_at DATETIME NULL AFTER source_file_size,
  ADD COLUMN attempt_count INT NOT NULL DEFAULT 0 AFTER status,
  ADD COLUMN processing_started_at DATETIME NULL AFTER attempt_count,
  ADD COLUMN failure_code VARCHAR(64) NULL AFTER processing_started_at;

CREATE INDEX idx_import_jobs_status_started
  ON import_jobs (status, processing_started_at);
CREATE INDEX idx_import_jobs_storage_key
  ON import_jobs (source_file_storage_key);

CREATE TABLE auth_login_rate_limits (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  route_key VARCHAR(32) NOT NULL,
  subject_hash VARCHAR(64) NOT NULL,
  window_started_at DATETIME NOT NULL,
  attempt_count INT NOT NULL DEFAULT 0,
  blocked_until DATETIME NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_auth_rate_route_subject (route_key, subject_hash),
  KEY idx_auth_rate_blocked (blocked_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE auth_security_events (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  event_type VARCHAR(32) NOT NULL,
  outcome VARCHAR(16) NOT NULL,
  route_key VARCHAR(32) NOT NULL,
  subject_hash VARCHAR(64) NOT NULL,
  ip_hash VARCHAR(64) NOT NULL,
  user_id BIGINT NULL,
  city_id BIGINT NULL,
  reason_code VARCHAR(64) NOT NULL,
  request_id VARCHAR(64) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_auth_event_created (created_at),
  KEY idx_auth_event_subject (subject_hash, created_at),
  KEY idx_auth_event_ip (ip_hash, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
