-- ============================================================================
-- 维护管理经营数据中台（新基线）— 数据基础 010：新基线业务表
-- 版本：010_biz_baseline_tables
-- 来源：07-数据模型与技术架构方案-v1.0（TABLE 3-7）+ M1 模型设计
-- 说明：
--   1. 本迁移只追加新表（biz_ 前缀），不改动 001-009 既有迁移与旧表；
--   2. 主键一律 UUID（VARCHAR(36)），真实合同号等业务唯一键另建 UNIQUE；
--   3. 金额统一 BIGINT 整数分，费率统一 INT 整数基点；
--   4. 业务月份统一 VARCHAR(7) 'YYYY-MM'；
--   5. 索引使用独立 CREATE INDEX（SQLite/MySQL 双兼容，避免 toSqlite 跳过 KEY 行）；
--   6. 外键采用逻辑约束（服务层校验），首发不建 DB 外键以兼容双库；
--   7. 敏感订单字段（col_19/20/21）字段名带 _enc 后缀，存储加密策略 M4/M8 落地。
-- ============================================================================

SET NAMES utf8mb4;

-- ----------------------------
-- 1. 省份标准字典
-- ----------------------------
CREATE TABLE biz_provinces (
  id VARCHAR(36) PRIMARY KEY,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(100) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX uk_biz_provinces_code ON biz_provinces (code);
CREATE UNIQUE INDEX uk_biz_provinces_name ON biz_provinces (name);

-- ----------------------------
-- 2. 地市标准字典（归属省份）
-- ----------------------------
CREATE TABLE biz_cities (
  id VARCHAR(36) PRIMARY KEY,
  province_id VARCHAR(36) NOT NULL,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(100) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE INDEX idx_biz_cities_province ON biz_cities (province_id);
CREATE UNIQUE INDEX uk_biz_cities_code ON biz_cities (code);
CREATE UNIQUE INDEX uk_biz_cities_province_name ON biz_cities (province_id, name);

-- ----------------------------
-- 3. 地市别名
-- ----------------------------
CREATE TABLE biz_city_aliases (
  id VARCHAR(36) PRIMARY KEY,
  city_id VARCHAR(36) NOT NULL,
  alias VARCHAR(100) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX uk_biz_city_alias ON biz_city_aliases (city_id, alias);

-- ----------------------------
-- 4. 用户（四角色）
-- ----------------------------
CREATE TABLE biz_users (
  id VARCHAR(36) PRIMARY KEY,
  username VARCHAR(64) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role_code VARCHAR(32) NOT NULL,
  name VARCHAR(100) NOT NULL,
  city_id VARCHAR(36) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'enabled',
  auth_version INT NOT NULL DEFAULT 1,
  sensitive_order_scope VARCHAR(16) NOT NULL DEFAULT 'masked',
  must_change_password BOOLEAN NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX uk_biz_users_username ON biz_users (username);
CREATE INDEX idx_biz_users_role ON biz_users (role_code);
CREATE INDEX idx_biz_users_city ON biz_users (city_id);

-- ----------------------------
-- 5. 模块（一级/二级门户）
-- ----------------------------
CREATE TABLE biz_modules (
  id VARCHAR(36) PRIMARY KEY,
  code VARCHAR(64) NOT NULL,
  name VARCHAR(100) NOT NULL,
  level VARCHAR(16) NOT NULL,
  parent_id VARCHAR(36) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX uk_biz_modules_code ON biz_modules (code);

-- ----------------------------
-- 6. 角色
-- ----------------------------
CREATE TABLE biz_roles (
  id VARCHAR(36) PRIMARY KEY,
  code VARCHAR(32) NOT NULL,
  name VARCHAR(100) NOT NULL,
  is_builtin BOOLEAN NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX uk_biz_roles_code ON biz_roles (code);

-- ----------------------------
-- 7. 权限点（模块-页面-操作）
-- ----------------------------
CREATE TABLE biz_permissions (
  id VARCHAR(36) PRIMARY KEY,
  code VARCHAR(128) NOT NULL,
  name VARCHAR(100) NOT NULL,
  module_id VARCHAR(36) NOT NULL,
  action VARCHAR(16) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX uk_biz_permission_code ON biz_permissions (code);

-- ----------------------------
-- 8. 角色-权限关联
-- ----------------------------
CREATE TABLE biz_role_permissions (
  id VARCHAR(36) PRIMARY KEY,
  role_id VARCHAR(36) NOT NULL,
  permission_code VARCHAR(128) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX uk_biz_role_permission ON biz_role_permissions (role_id, permission_code);

-- ----------------------------
-- 9. 账户例外权限（allow/deny）
-- ----------------------------
CREATE TABLE biz_user_permission_overrides (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  permission_code VARCHAR(128) NOT NULL,
  effect VARCHAR(8) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX uk_biz_user_perm_override ON biz_user_permission_overrides (user_id, permission_code);

-- ----------------------------
-- 10. 用户数据范围
-- ----------------------------
CREATE TABLE biz_user_data_scopes (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  province_id VARCHAR(36) NULL,
  city_id VARCHAR(36) NULL,
  scope_type VARCHAR(16) NOT NULL DEFAULT 'city',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE INDEX idx_biz_user_scope_user ON biz_user_data_scopes (user_id);
CREATE UNIQUE INDEX uk_biz_user_scope_province_city ON biz_user_data_scopes (user_id, province_id, city_id);

-- ----------------------------
-- 11. 合同
-- ----------------------------
CREATE TABLE biz_contracts (
  id VARCHAR(36) PRIMARY KEY,
  contract_no VARCHAR(100) NOT NULL,
  contract_name VARCHAR(255) NOT NULL,
  tax_inclusive_amount_fen BIGINT NOT NULL,
  tax_exclusive_amount_fen BIGINT NULL,
  province_id VARCHAR(36) NOT NULL,
  start_date DATE NULL,
  end_date DATE NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  tags JSON NULL,
  amount_locked BOOLEAN NOT NULL DEFAULT 0,
  void_summary_choice VARCHAR(24) NULL,
  parent_contract_id VARCHAR(36) NULL,
  version_no INT NOT NULL DEFAULT 1,
  created_by VARCHAR(36) NOT NULL,
  updated_by VARCHAR(36) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX uk_biz_contracts_no ON biz_contracts (contract_no);
CREATE INDEX idx_biz_contracts_status ON biz_contracts (status);
CREATE INDEX idx_biz_contracts_province ON biz_contracts (province_id);
CREATE INDEX idx_biz_contracts_parent ON biz_contracts (parent_contract_id);

-- ----------------------------
-- 12. 合同-地市分配
-- ----------------------------
CREATE TABLE biz_contract_city_allocations (
  id VARCHAR(36) PRIMARY KEY,
  contract_id VARCHAR(36) NOT NULL,
  city_id VARCHAR(36) NOT NULL,
  quota_fen BIGINT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  effective_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  cancelled_at DATETIME NULL,
  version_no INT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE INDEX idx_biz_city_alloc_contract ON biz_contract_city_allocations (contract_id);
CREATE INDEX idx_biz_city_alloc_city ON biz_contract_city_allocations (city_id);
CREATE UNIQUE INDEX uk_biz_city_alloc_contract_city ON biz_contract_city_allocations (contract_id, city_id);

-- ----------------------------
-- 13. 合同-地市管理费率历史（整数基点）
-- ----------------------------
CREATE TABLE biz_contract_fee_rates (
  id VARCHAR(36) PRIMARY KEY,
  contract_id VARCHAR(36) NOT NULL,
  city_id VARCHAR(36) NOT NULL,
  effective_month VARCHAR(7) NOT NULL,
  rate_bp INT NOT NULL,
  change_reason VARCHAR(255) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE INDEX idx_biz_fee_rate_contract_city ON biz_contract_fee_rates (contract_id, city_id);
CREATE UNIQUE INDEX uk_biz_fee_rate_contract_city_month ON biz_contract_fee_rates (contract_id, city_id, effective_month);

-- ----------------------------
-- 14. 合同预警
-- ----------------------------
CREATE TABLE biz_contract_alerts (
  id VARCHAR(36) PRIMARY KEY,
  contract_id VARCHAR(36) NOT NULL,
  alert_type VARCHAR(24) NOT NULL,
  first_triggered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_triggered_at DATETIME NULL,
  current_status VARCHAR(16) NOT NULL DEFAULT 'active',
  resolved_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE INDEX idx_biz_contract_alert_contract ON biz_contract_alerts (contract_id);
CREATE INDEX idx_biz_contract_alert_type_status ON biz_contract_alerts (alert_type, current_status);

-- ----------------------------
-- 15. 订单导入批次
-- ----------------------------
CREATE TABLE biz_order_import_batches (
  id VARCHAR(36) PRIMARY KEY,
  filename VARCHAR(255) NOT NULL,
  file_hash VARCHAR(64) NOT NULL,
  max_order_time DATETIME NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'parsing',
  total_rows INT NOT NULL DEFAULT 0,
  imported_rows INT NOT NULL DEFAULT 0,
  uploaded_by VARCHAR(36) NOT NULL,
  uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  failure_reason TEXT NULL,
  voided_by VARCHAR(36) NULL,
  voided_at DATETIME NULL,
  void_reason VARCHAR(255) NULL,
  restored_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX uk_biz_order_batch_idempotency ON biz_order_import_batches (idempotency_key);
CREATE UNIQUE INDEX uk_biz_order_batch_fingerprint ON biz_order_import_batches (file_hash, max_order_time);
CREATE INDEX idx_biz_order_batch_uploader ON biz_order_import_batches (uploaded_by);

-- ----------------------------
-- 16. 订单原始行（34 列原值 + 标准化字段）
-- ----------------------------
CREATE TABLE biz_order_rows (
  id VARCHAR(36) PRIMARY KEY,
  batch_id VARCHAR(36) NOT NULL,
  source_row_no INT NOT NULL,
  col_01 VARCHAR(100) NULL,
  col_02 VARCHAR(100) NULL,
  col_03 VARCHAR(160) NULL,
  col_04 VARCHAR(255) NULL,
  col_05 VARCHAR(100) NULL,
  col_06 VARCHAR(64) NULL,
  col_07 VARCHAR(1000) NULL,
  col_08 VARCHAR(160) NULL,
  col_09 VARCHAR(100) NULL,
  col_10 VARCHAR(64) NULL,
  col_11 VARCHAR(64) NULL,
  col_12 VARCHAR(64) NULL,
  col_13 VARCHAR(100) NULL,
  col_14 VARCHAR(64) NULL,
  col_15 VARCHAR(64) NULL,
  col_16 VARCHAR(64) NULL,
  col_17 VARCHAR(64) NULL,
  col_18 VARCHAR(64) NULL,
  col_19 VARCHAR(255) NULL,
  col_20 VARCHAR(255) NULL,
  col_21 VARCHAR(500) NULL,
  col_22 VARCHAR(255) NULL,
  col_23 VARCHAR(64) NULL,
  col_24 VARCHAR(64) NULL,
  col_25 VARCHAR(500) NULL,
  col_26 VARCHAR(160) NULL,
  col_27 VARCHAR(1000) NULL,
  col_28 VARCHAR(160) NULL,
  col_29 VARCHAR(1000) NULL,
  col_30 VARCHAR(100) NULL,
  col_31 VARCHAR(1000) NULL,
  col_32 VARCHAR(160) NULL,
  col_33 VARCHAR(64) NULL,
  col_34 VARCHAR(64) NULL,
  province_id VARCHAR(36) NULL,
  city_id VARCHAR(36) NULL,
  contract_id VARCHAR(36) NULL,
  order_time_std DATETIME NULL,
  notice_time_std DATETIME NULL,
  business_month VARCHAR(7) NULL,
  completion_amount_fen BIGINT NULL,
  fee_rate_snapshot_bp INT NULL,
  gross_profit_fen BIGINT NULL,
  city_overrun_flag BOOLEAN NOT NULL DEFAULT 0,
  contract_overrun_flag BOOLEAN NOT NULL DEFAULT 0,
  is_void BOOLEAN NOT NULL DEFAULT 0,
  void_reason VARCHAR(255) NULL,
  source_row_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_biz_order_row_batch ON biz_order_rows (batch_id);
CREATE INDEX idx_biz_order_row_city_month ON biz_order_rows (city_id, business_month);
CREATE INDEX idx_biz_order_row_contract ON biz_order_rows (contract_id);

-- ----------------------------
-- 17. 订单导入错误报告
-- ----------------------------
CREATE TABLE biz_order_import_errors (
  id VARCHAR(36) PRIMARY KEY,
  batch_id VARCHAR(36) NOT NULL,
  error_type VARCHAR(32) NOT NULL,
  row_no INT NULL,
  field VARCHAR(100) NULL,
  message TEXT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_biz_order_error_batch ON biz_order_import_errors (batch_id);

-- ----------------------------
-- 18. 线下完工
-- ----------------------------
CREATE TABLE biz_offline_completions (
  id VARCHAR(36) PRIMARY KEY,
  contract_id VARCHAR(36) NOT NULL,
  city_id VARCHAR(36) NOT NULL,
  business_month VARCHAR(7) NOT NULL,
  amount_fen BIGINT NOT NULL,
  summary VARCHAR(500) NOT NULL,
  attachment_ref VARCHAR(255) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  city_overrun_flag BOOLEAN NOT NULL DEFAULT 0,
  contract_overrun_flag BOOLEAN NOT NULL DEFAULT 0,
  submitted_by VARCHAR(36) NULL,
  submitted_at DATETIME NULL,
  reviewer_id VARCHAR(36) NULL,
  reviewed_at DATETIME NULL,
  review_comment VARCHAR(500) NULL,
  voided_by VARCHAR(36) NULL,
  voided_at DATETIME NULL,
  void_reason VARCHAR(255) NULL,
  version_no INT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE INDEX idx_biz_offline_contract ON biz_offline_completions (contract_id);
CREATE INDEX idx_biz_offline_city_month ON biz_offline_completions (city_id, business_month);
CREATE INDEX idx_biz_offline_status ON biz_offline_completions (status);

-- ----------------------------
-- 19. 地市月度成本（不关联合同）
-- ----------------------------
CREATE TABLE biz_cost_entries (
  id VARCHAR(36) PRIMARY KEY,
  city_id VARCHAR(36) NOT NULL,
  business_month VARCHAR(7) NOT NULL,
  category_code VARCHAR(50) NOT NULL,
  amount_fen BIGINT NOT NULL,
  description VARCHAR(500) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  submitted_by VARCHAR(36) NULL,
  submitted_at DATETIME NULL,
  reviewer_id VARCHAR(36) NULL,
  reviewed_at DATETIME NULL,
  review_comment VARCHAR(500) NULL,
  voided_by VARCHAR(36) NULL,
  voided_at DATETIME NULL,
  void_reason VARCHAR(255) NULL,
  version_no INT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE INDEX idx_biz_cost_city_month ON biz_cost_entries (city_id, business_month);
CREATE INDEX idx_biz_cost_status ON biz_cost_entries (status);

-- ----------------------------
-- 20. 成本分类字典
-- ----------------------------
CREATE TABLE biz_cost_categories (
  id VARCHAR(36) PRIMARY KEY,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  sort_order INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX uk_biz_cost_categories_code ON biz_cost_categories (code);

-- ----------------------------
-- 21. 月度汇总（可由权威明细重建）
-- ----------------------------
CREATE TABLE biz_monthly_aggregates (
  id VARCHAR(36) PRIMARY KEY,
  province_id VARCHAR(36) NOT NULL,
  city_id VARCHAR(36) NULL,
  contract_id VARCHAR(36) NULL,
  business_month VARCHAR(7) NOT NULL,
  order_completion_fen BIGINT NOT NULL DEFAULT 0,
  offline_completion_fen BIGINT NOT NULL DEFAULT 0,
  gross_profit_fen BIGINT NOT NULL DEFAULT 0,
  cost_fen BIGINT NOT NULL DEFAULT 0,
  net_profit_fen BIGINT NOT NULL DEFAULT 0,
  stale_flag BOOLEAN NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX uk_biz_agg_dim_month ON biz_monthly_aggregates (province_id, city_id, contract_id, business_month);
CREATE INDEX idx_biz_agg_city_month ON biz_monthly_aggregates (city_id, business_month);
CREATE INDEX idx_biz_agg_contract_month ON biz_monthly_aggregates (contract_id, business_month);

-- ----------------------------
-- 22. 汇总异常
-- ----------------------------
CREATE TABLE biz_aggregate_failures (
  id VARCHAR(36) PRIMARY KEY,
  business_object_type VARCHAR(64) NOT NULL,
  business_object_id VARCHAR(36) NOT NULL,
  scope_desc VARCHAR(500) NULL,
  error TEXT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'open',
  first_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_at DATETIME NULL,
  recalculated_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE INDEX idx_biz_agg_failure_status ON biz_aggregate_failures (status);
CREATE INDEX idx_biz_agg_failure_scope ON biz_aggregate_failures (business_object_type, business_object_id);

-- ----------------------------
-- 23. 汇总重算任务
-- ----------------------------
CREATE TABLE biz_recalc_tasks (
  id VARCHAR(36) PRIMARY KEY,
  scope_type VARCHAR(16) NOT NULL,
  scope_desc VARCHAR(1000) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  requested_by VARCHAR(36) NOT NULL,
  requested_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME NULL,
  finished_at DATETIME NULL,
  error TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE INDEX idx_biz_recalc_status ON biz_recalc_tasks (status);

-- ----------------------------
-- 24. 站内消息
-- ----------------------------
CREATE TABLE biz_messages (
  id VARCHAR(36) PRIMARY KEY,
  recipient_id VARCHAR(36) NOT NULL,
  message_type VARCHAR(32) NOT NULL,
  business_object_id VARCHAR(36) NULL,
  content VARCHAR(1000) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'unread',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_biz_message_recipient ON biz_messages (recipient_id, status);
CREATE INDEX idx_biz_message_type ON biz_messages (message_type);

-- ----------------------------
-- 25. 最小操作日志（不保存字段修改前后值）
-- ----------------------------
CREATE TABLE biz_operation_logs (
  id VARCHAR(36) PRIMARY KEY,
  operator_user_id VARCHAR(36) NOT NULL,
  action_type VARCHAR(64) NOT NULL,
  target_type VARCHAR(64) NOT NULL,
  target_id VARCHAR(36) NOT NULL,
  result_status VARCHAR(16) NOT NULL DEFAULT 'success',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_biz_op_log_created_at ON biz_operation_logs (created_at);
CREATE INDEX idx_biz_op_log_user ON biz_operation_logs (operator_user_id);
CREATE INDEX idx_biz_op_log_target ON biz_operation_logs (target_type, target_id);
