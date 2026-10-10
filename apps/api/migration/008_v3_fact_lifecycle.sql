-- V3 fact lifecycle, effective-version relations, warning evidence, and optimistic concurrency metadata.
-- Existing migrations are immutable; apply only through scripts/db/migrate.mjs.

ALTER TABLE fact_import_batches
  ADD COLUMN lifecycle_status VARCHAR(32) NOT NULL DEFAULT 'processing' AFTER status,
  ADD COLUMN warning_count INT NOT NULL DEFAULT 0 AFTER error_rows,
  ADD COLUMN blocking_error_count INT NOT NULL DEFAULT 0 AFTER warning_count,
  ADD COLUMN effective_at DATETIME NULL AFTER completed_at;

UPDATE fact_import_batches
SET lifecycle_status = CASE
  WHEN status = 'completed' THEN 'current_effective'
  WHEN status = 'failed' THEN 'validation_failed'
  ELSE 'processing'
END,
blocking_error_count = CASE WHEN status = 'failed' THEN error_rows ELSE 0 END,
effective_at = CASE WHEN status = 'completed' THEN completed_at ELSE NULL END;

CREATE INDEX idx_fact_batch_lifecycle ON fact_import_batches (city_id, fact_kind, lifecycle_status, created_at);

ALTER TABLE fact_versions
  ADD COLUMN city_id BIGINT NULL AFTER fact_id,
  ADD COLUMN contract_id BIGINT NULL AFTER city_id,
  ADD COLUMN period_year INT NULL AFTER contract_id,
  ADD COLUMN period_month TINYINT NULL AFTER period_year,
  ADD COLUMN lifecycle_status VARCHAR(32) NOT NULL DEFAULT 'current_effective' AFTER change_type,
  ADD COLUMN supersedes_version_id BIGINT NULL AFTER lifecycle_status,
  ADD COLUMN superseded_by_version_id BIGINT NULL AFTER supersedes_version_id,
  ADD COLUMN changed_fields_json JSON NULL AFTER after_data_json,
  ADD COLUMN warning_summary_json JSON NULL AFTER changed_fields_json;

UPDATE fact_versions fv
JOIN cost_facts f ON fv.fact_type = 'cost' AND fv.fact_id = f.id
SET fv.city_id = f.city_id, fv.contract_id = f.contract_id,
    fv.period_year = f.period_year, fv.period_month = f.period_month;

UPDATE fact_versions fv
JOIN order_facts f ON fv.fact_type = 'order' AND fv.fact_id = f.id
SET fv.city_id = f.city_id, fv.contract_id = f.contract_id,
    fv.period_year = f.period_year, fv.period_month = f.period_month;

UPDATE fact_versions fv
JOIN (
  SELECT fact_type, fact_id, MAX(version_no) AS max_version_no
  FROM fact_versions
  GROUP BY fact_type, fact_id
) latest ON latest.fact_type = fv.fact_type AND latest.fact_id = fv.fact_id
SET fv.lifecycle_status = CASE
  WHEN fv.version_no = latest.max_version_no THEN 'current_effective'
  ELSE 'replaced'
END;

UPDATE fact_versions current_version
JOIN fact_versions previous_version
  ON previous_version.fact_type = current_version.fact_type
 AND previous_version.fact_id = current_version.fact_id
 AND previous_version.version_no = current_version.version_no - 1
SET current_version.supersedes_version_id = previous_version.id,
    previous_version.superseded_by_version_id = current_version.id;

CREATE INDEX idx_fact_version_scope_status ON fact_versions (city_id, lifecycle_status, created_at);
CREATE INDEX idx_fact_version_fact_chain ON fact_versions (fact_type, fact_id, version_no);

ALTER TABLE fact_versions
  ADD CONSTRAINT fk_fact_version_supersedes FOREIGN KEY (supersedes_version_id) REFERENCES fact_versions (id),
  ADD CONSTRAINT fk_fact_version_superseded_by FOREIGN KEY (superseded_by_version_id) REFERENCES fact_versions (id);
