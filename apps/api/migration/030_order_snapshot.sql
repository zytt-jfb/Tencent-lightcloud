-- Preserve existing statistics until the first successful full snapshot replaces them.
ALTER TABLE biz_order_rows ADD COLUMN is_current BOOLEAN NOT NULL DEFAULT 1;
CREATE INDEX idx_order_current ON biz_order_rows (is_current, validation_status, is_void);
ALTER TABLE biz_order_import_batches ADD COLUMN lifecycle_status VARCHAR(16) NOT NULL DEFAULT 'historical';
CREATE TABLE biz_order_snapshot_lock (id INT PRIMARY KEY, revision INT NOT NULL DEFAULT 0);
INSERT INTO biz_order_snapshot_lock (id, revision) VALUES (1, 0);
