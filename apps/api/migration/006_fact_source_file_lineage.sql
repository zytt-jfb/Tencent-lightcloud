-- V3.1 immutable source-file lineage metadata.
-- File bytes are kept in controlled storage; the database stores the content-addressed key.

ALTER TABLE fact_import_batches
  ADD COLUMN source_file_storage_key VARCHAR(500) NULL AFTER source_file_sha256,
  ADD COLUMN source_file_size BIGINT NULL AFTER source_file_storage_key,
  ADD COLUMN source_file_stored_at DATETIME NULL AFTER source_file_size;

CREATE INDEX idx_fact_batch_storage_key ON fact_import_batches (source_file_storage_key);
