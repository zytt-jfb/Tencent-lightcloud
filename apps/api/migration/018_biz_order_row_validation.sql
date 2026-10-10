-- Preserve imported raw order rows even when reference-data validation requires manual maintenance.
ALTER TABLE biz_order_rows
  ADD COLUMN validation_status VARCHAR(16) NOT NULL DEFAULT 'valid',
  ADD COLUMN validation_error TEXT NULL;
