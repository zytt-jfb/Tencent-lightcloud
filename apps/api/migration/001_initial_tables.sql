-- ============================================================================
-- 经营单元上报系统 - 数据库初始化迁移
-- 版本：001_initial
-- 来源：biz-reporting-mysql-ddl.sql (17 张表)
-- 字符集：utf8mb4
-- ============================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ----------------------------
-- 1. 城市表
-- ----------------------------
CREATE TABLE cities (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(100) NOT NULL,
  code VARCHAR(50) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_cities_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- 2. 用户表（双角色：system_admin / city_user）
-- ----------------------------
CREATE TABLE users (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  role VARCHAR(32) NOT NULL,
  name VARCHAR(100) NOT NULL,
  city_id BIGINT NULL,
  openid VARCHAR(128) NULL,
  username VARCHAR(100) NULL,
  password_hash VARCHAR(255) NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'enabled',
  register_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_users_openid (openid),
  UNIQUE KEY uk_users_username (username),
  KEY idx_users_city_id (city_id),
  KEY idx_users_role_status (role, status),
  KEY idx_users_last_login_at (last_login_at),
  CONSTRAINT fk_users_city_id FOREIGN KEY (city_id) REFERENCES cities (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- 3. 城市配置表（控制维保开关等）
-- ----------------------------
CREATE TABLE city_configs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  city_id BIGINT NOT NULL,
  enable_maintenance TINYINT(1) NOT NULL DEFAULT 0,
  updated_by BIGINT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_city_configs_city_id (city_id),
  CONSTRAINT fk_city_configs_city_id FOREIGN KEY (city_id) REFERENCES cities (id),
  CONSTRAINT fk_city_configs_updated_by FOREIGN KEY (updated_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- 4. 合同表（支持软删除）
-- ----------------------------
CREATE TABLE contracts (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  contract_code VARCHAR(100) NOT NULL,
  contract_name VARCHAR(255) NOT NULL,
  contract_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  rate DECIMAL(8,4) NOT NULL DEFAULT 0,
  accumulated_order_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  accumulated_invoice_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  sign_date DATE NULL,
  expire_date DATE NULL,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  deleted_at DATETIME NULL,
  created_by BIGINT NOT NULL,
  updated_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_contracts_contract_code (contract_code),
  KEY idx_contracts_is_deleted (is_deleted),
  KEY idx_contracts_contract_name (contract_name),
  CONSTRAINT fk_contracts_created_by FOREIGN KEY (created_by) REFERENCES users (id),
  CONSTRAINT fk_contracts_updated_by FOREIGN KEY (updated_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- 5. 合同跨地市分配表
-- ----------------------------
CREATE TABLE contract_city_allocations (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  contract_id BIGINT NOT NULL,
  city_id BIGINT NOT NULL,
  city_contract_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  rate DECIMAL(8,4) NOT NULL DEFAULT 0,
  accumulated_order_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  accumulated_invoice_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_allocations_contract_city (contract_id, city_id),
  KEY idx_allocations_city_id (city_id),
  KEY idx_allocations_contract_id (contract_id),
  CONSTRAINT fk_allocations_contract_id FOREIGN KEY (contract_id) REFERENCES contracts (id),
  CONSTRAINT fk_allocations_city_id FOREIGN KEY (city_id) REFERENCES cities (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- 6. 年度报表包表（城市 × 年度唯一）
-- ----------------------------
CREATE TABLE annual_report_packages (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  city_id BIGINT NOT NULL,
  report_year INT NOT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  last_updated_by BIGINT NULL,
  last_updated_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_packages_city_year (city_id, report_year),
  KEY idx_packages_status (status),
  CONSTRAINT fk_packages_city_id FOREIGN KEY (city_id) REFERENCES cities (id),
  CONSTRAINT fk_packages_last_updated_by FOREIGN KEY (last_updated_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- 7. 合同月度填报行
-- ----------------------------
CREATE TABLE report_contract_monthly_rows (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  package_id BIGINT NOT NULL,
  contract_id BIGINT NULL,
  contract_code_snapshot VARCHAR(100) NOT NULL,
  contract_name_snapshot VARCHAR(255) NOT NULL,
  city_allocation_id BIGINT NULL,
  month_no TINYINT NOT NULL,
  completion_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  acceptance_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  is_locked TINYINT(1) NOT NULL DEFAULT 0,
  lock_reason VARCHAR(100) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_contract_rows_pkg_code_month (package_id, contract_code_snapshot, month_no),
  KEY idx_contract_rows_package_month (package_id, month_no),
  KEY idx_contract_rows_lock (is_locked),
  CONSTRAINT fk_contract_rows_package_id FOREIGN KEY (package_id) REFERENCES annual_report_packages (id),
  CONSTRAINT fk_contract_rows_contract_id FOREIGN KEY (contract_id) REFERENCES contracts (id),
  CONSTRAINT fk_contract_rows_allocation_id FOREIGN KEY (city_allocation_id) REFERENCES contract_city_allocations (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- 8. 费用月度填报行（7 大类别）
-- ----------------------------
CREATE TABLE report_cost_monthly_rows (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  package_id BIGINT NOT NULL,
  month_no TINYINT NOT NULL,
  cost_category_code VARCHAR(50) NOT NULL,
  amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_cost_rows_pkg_month_cat (package_id, month_no, cost_category_code),
  KEY idx_cost_rows_package_month (package_id, month_no),
  CONSTRAINT fk_cost_rows_package_id FOREIGN KEY (package_id) REFERENCES annual_report_packages (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- 9. 维保月度填报行（按城市配置启用）
-- ----------------------------
CREATE TABLE report_maintenance_monthly_rows (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  package_id BIGINT NOT NULL,
  month_no TINYINT NOT NULL,
  invoice_total_prev_year DECIMAL(18,2) NOT NULL DEFAULT 0,
  invoice_month_count_prev_year INT NOT NULL DEFAULT 0,
  invoice_total_current_year DECIMAL(18,2) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_maintenance_rows_pkg_month (package_id, month_no),
  KEY idx_maintenance_rows_package_month (package_id, month_no),
  CONSTRAINT fk_maintenance_rows_package_id FOREIGN KEY (package_id) REFERENCES annual_report_packages (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- 10. 月度解锁授权表
-- ----------------------------
CREATE TABLE month_unlock_grants (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  package_id BIGINT NOT NULL,
  month_no TINYINT NOT NULL,
  expires_at DATETIME NOT NULL,
  granted_by BIGINT NOT NULL,
  reason VARCHAR(500) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_unlock_grants_package_month (package_id, month_no),
  KEY idx_unlock_grants_expires_at (expires_at),
  CONSTRAINT fk_unlock_grants_package_id FOREIGN KEY (package_id) REFERENCES annual_report_packages (id),
  CONSTRAINT fk_unlock_grants_granted_by FOREIGN KEY (granted_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- 11. 月度快照表（提交时生成不可变快照）
-- ----------------------------
CREATE TABLE month_snapshots (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  package_id BIGINT NOT NULL,
  city_id BIGINT NOT NULL,
  report_year INT NOT NULL,
  belong_month TINYINT NOT NULL,
  actual_submitted_at DATETIME NOT NULL,
  is_overdue TINYINT(1) NOT NULL DEFAULT 0,
  summary_json JSON NOT NULL,
  contract_rows_json JSON NOT NULL,
  cost_rows_json JSON NOT NULL,
  maintenance_rows_json JSON NULL,
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_snapshots_package_month (package_id, belong_month),
  KEY idx_snapshots_city_year_month (city_id, report_year, belong_month),
  KEY idx_snapshots_submitted_at (actual_submitted_at),
  CONSTRAINT fk_snapshots_package_id FOREIGN KEY (package_id) REFERENCES annual_report_packages (id),
  CONSTRAINT fk_snapshots_city_id FOREIGN KEY (city_id) REFERENCES cities (id),
  CONSTRAINT fk_snapshots_created_by FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- 12. 消息表
-- ----------------------------
CREATE TABLE messages (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  message_type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  summary VARCHAR(500) NOT NULL,
  payload_json JSON NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at DATETIME NULL,
  KEY idx_messages_user_created_at (user_id, created_at),
  KEY idx_messages_user_is_read (user_id, is_read),
  CONSTRAINT fk_messages_user_id FOREIGN KEY (user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- 13. 提醒日志表
-- ----------------------------
CREATE TABLE reminder_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  city_id BIGINT NOT NULL,
  report_year INT NOT NULL,
  belong_month TINYINT NOT NULL,
  trigger_type VARCHAR(32) NOT NULL,
  recipient_user_id BIGINT NOT NULL,
  sender_user_id BIGINT NULL,
  status VARCHAR(32) NOT NULL,
  sent_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_reminder_city_month (city_id, report_year, belong_month),
  KEY idx_reminder_recipient (recipient_user_id),
  CONSTRAINT fk_reminder_city_id FOREIGN KEY (city_id) REFERENCES cities (id),
  CONSTRAINT fk_reminder_recipient_user_id FOREIGN KEY (recipient_user_id) REFERENCES users (id),
  CONSTRAINT fk_reminder_sender_user_id FOREIGN KEY (sender_user_id) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- 14. 导入任务表
-- ----------------------------
CREATE TABLE import_jobs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  job_type VARCHAR(32) NOT NULL,
  operator_user_id BIGINT NOT NULL,
  city_id BIGINT NULL,
  status VARCHAR(32) NOT NULL,
  source_file_url VARCHAR(500) NOT NULL,
  parsed_summary_json JSON NULL,
  diff_summary_json JSON NULL,
  error_summary_json JSON NULL,
  confirmed_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_import_jobs_type_status (job_type, status),
  KEY idx_import_jobs_operator (operator_user_id),
  CONSTRAINT fk_import_jobs_operator_user_id FOREIGN KEY (operator_user_id) REFERENCES users (id),
  CONSTRAINT f_import_jobs_city_id FOREIGN KEY (city_id) REFERENCES cities (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- 15. 导出任务表
-- ----------------------------
CREATE TABLE export_jobs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  operator_user_id BIGINT NOT NULL,
  export_mode VARCHAR(32) NOT NULL,
  scope_type VARCHAR(32) NOT NULL,
  city_id BIGINT NULL,
  report_year INT NOT NULL,
  belong_month TINYINT NULL,
  snapshot_range VARCHAR(32) NULL,
  status VARCHAR(32) NOT NULL,
  file_url VARCHAR(500) NULL,
  expires_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_export_jobs_operator_status (operator_user_id, status),
  CONSTRAINT fk_export_jobs_operator_user_id FOREIGN KEY (operator_user_id) REFERENCES users (id),
  CONSTRAINT fk_export_jobs_city_id FOREIGN KEY (city_id) REFERENCES cities (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- 16. 重算任务表
-- ----------------------------
CREATE TABLE recalc_tasks (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  task_type VARCHAR(32) NOT NULL,
  related_import_job_id BIGINT NULL,
  status VARCHAR(32) NOT NULL,
  scope_json JSON NOT NULL,
  error_message VARCHAR(1000) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_recalc_status (status),
  KEY idx_recalc_import_job (related_import_job_id),
  CONSTRAINT fk_recalc_related_import_job_id FOREIGN KEY (related_import_job_id) REFERENCES import_jobs (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------
-- 17. 操作日志表
-- ----------------------------
CREATE TABLE operation_logs (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  operator_user_id BIGINT NOT NULL,
  operator_city_id BIGINT NULL,
  action_type VARCHAR(64) NOT NULL,
  target_type VARCHAR(64) NOT NULL,
  target_id VARCHAR(128) NOT NULL,
  summary_text VARCHAR(1000) NOT NULL,
  before_data_json JSON NULL,
  after_data_json JSON NULL,
  result_status VARCHAR(32) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_operation_logs_created_at (created_at),
  KEY idx_operation_logs_action_type (action_type),
  KEY idx_operation_logs_target (target_type, target_id),
  KEY idx_operation_logs_operator (operator_user_id),
  CONSTRAINT fk_operation_logs_operator_user_id FOREIGN KEY (operator_user_id) REFERENCES users (id),
  CONSTRAINT fk_operation_logs_operator_city_id FOREIGN KEY (operator_city_id) REFERENCES cities (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;
