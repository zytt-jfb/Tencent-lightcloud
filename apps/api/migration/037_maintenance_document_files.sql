-- 维护管理：人员、车辆、油机的证件/保单/保养资料原文件
CREATE TABLE maintenance_document_files (
  id VARCHAR(36) NOT NULL PRIMARY KEY,
  maintenance_kind VARCHAR(16) NOT NULL,
  maintenance_id VARCHAR(36) NULL,
  document_category VARCHAR(64) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  file_size BIGINT NOT NULL,
  file_sha256 VARCHAR(64) NOT NULL,
  storage_key VARCHAR(500) NOT NULL,
  extracted_text TEXT NULL,
  created_by VARCHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_maintenance_document_owner (maintenance_kind, maintenance_id, created_at),
  KEY idx_maintenance_document_uploader (created_by, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
