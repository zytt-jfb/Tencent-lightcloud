-- 023：原始合同台账上传记录、工作表、来源行与标准化合同血缘。
ALTER TABLE biz_contracts ADD COLUMN archive_contract_no VARCHAR(100) NULL;
ALTER TABLE biz_contracts ADD COLUMN project_identity_code VARCHAR(160) NULL;
ALTER TABLE biz_contracts ADD COLUMN contract_category_1 VARCHAR(100) NULL;
ALTER TABLE biz_contracts ADD COLUMN contract_category_2 VARCHAR(100) NULL;
ALTER TABLE biz_contracts ADD COLUMN winning_project_name VARCHAR(500) NULL;
ALTER TABLE biz_contracts ADD COLUMN signed_date DATE NULL;
ALTER TABLE biz_contracts ADD COLUMN tax_rate_raw VARCHAR(255) NULL;
ALTER TABLE biz_contracts ADD COLUMN tax_rate_bp INT NULL;
ALTER TABLE biz_contracts ADD COLUMN tax_rate_bps_json JSON NULL;
ALTER TABLE biz_contracts ADD COLUMN source_import_record_id VARCHAR(36) NULL;
ALTER TABLE biz_contracts ADD COLUMN source_sheet_id VARCHAR(36) NULL;
ALTER TABLE biz_contracts ADD COLUMN source_row_id VARCHAR(36) NULL;
ALTER TABLE biz_contracts ADD COLUMN source_row_no INT NULL;
CREATE INDEX idx_biz_contracts_source_import ON biz_contracts (source_import_record_id);

CREATE TABLE biz_contract_import_records (
  id VARCHAR(36) PRIMARY KEY, filename VARCHAR(255) NOT NULL, file_hash VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'parsing', sheet_count INT NOT NULL DEFAULT 0,
  total_rows INT NOT NULL DEFAULT 0, valid_rows INT NOT NULL DEFAULT 0, review_rows INT NOT NULL DEFAULT 0,
  uploaded_by VARCHAR(36) NOT NULL, data_scope_json TEXT NULL, completed_at DATETIME NULL,
  failure_reason TEXT NULL, uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX uk_biz_contract_import_record_hash ON biz_contract_import_records (file_hash);
CREATE INDEX idx_biz_contract_import_record_uploaded ON biz_contract_import_records (uploaded_at);
CREATE INDEX idx_biz_contract_import_record_uploader ON biz_contract_import_records (uploaded_by);

CREATE TABLE biz_contract_import_sheets (
  id VARCHAR(36) PRIMARY KEY, import_record_id VARCHAR(36) NOT NULL, sheet_index INT NOT NULL,
  sheet_name VARCHAR(255) NOT NULL, start_row INT NOT NULL, start_col INT NOT NULL, row_count INT NOT NULL,
  column_count INT NOT NULL, header_row_no INT NULL, headers_json JSON NULL,
  is_contract_sheet BOOLEAN NOT NULL DEFAULT 0, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX uk_biz_contract_import_sheet_position ON biz_contract_import_sheets (import_record_id, sheet_index);

CREATE TABLE biz_contract_source_rows (
  id VARCHAR(36) PRIMARY KEY, import_record_id VARCHAR(36) NOT NULL, sheet_id VARCHAR(36) NOT NULL,
  source_row_no INT NOT NULL, row_kind VARCHAR(16) NOT NULL, cells_json JSON NOT NULL,
  normalization_status VARCHAR(16) NOT NULL DEFAULT 'archived', normalization_message TEXT NULL,
  province_id VARCHAR(36) NULL, city_id VARCHAR(36) NULL, contract_id VARCHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX uk_biz_contract_source_row_position ON biz_contract_source_rows (sheet_id, source_row_no);
CREATE INDEX idx_biz_contract_source_row_status ON biz_contract_source_rows (import_record_id, normalization_status);
