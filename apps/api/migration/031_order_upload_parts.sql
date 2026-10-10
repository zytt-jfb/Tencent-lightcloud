-- Shared temporary upload parts allow requests to land on different instances.
CREATE TABLE biz_order_upload_parts (
  upload_key VARCHAR(128) NOT NULL,
  part_index INT NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  part_count INT NOT NULL,
  filename VARCHAR(255) NOT NULL,
  source_batch_id VARCHAR(36) NULL,
  data_base64 LONGTEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (upload_key, part_index)
);
CREATE INDEX idx_order_upload_created ON biz_order_upload_parts (created_at);
