-- Forward-only compatibility fields required by the legacy import_jobs entity.
-- Existing migrations are immutable; dialect-aware execution lives in migrate.mjs.
ALTER TABLE import_jobs
  ADD COLUMN source_file_base64 LONGTEXT NULL,
  ADD COLUMN source_file_name VARCHAR(255) NULL,
  ADD COLUMN report_year INT NULL;
