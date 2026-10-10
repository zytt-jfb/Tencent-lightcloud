-- ============================================================================
-- 维护管理经营数据中台（新基线）— M6 汇总域 014：系统设置
-- 版本：014_biz_system_settings
-- 说明：到期预警阈值等配置进入系统设置（移除 M3 硬编码 90 天）。
--       幂等：INSERT-SELECT-WHERE-NOT-EXISTS。
-- ============================================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS biz_system_settings (
  id VARCHAR(36) NOT NULL,
  setting_key VARCHAR(64) NOT NULL,
  setting_value VARCHAR(255) NOT NULL,
  description VARCHAR(255) DEFAULT NULL,
  updated_by VARCHAR(36) DEFAULT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_biz_system_settings_key (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 种子：默认设置（幂等）
INSERT INTO biz_system_settings (id, setting_key, setting_value, description, updated_by)
SELECT '00000000-0000-4000-8000-000000000501', 'contract_expiry_warning_days', '90', '合同到期预警提前天数', NULL
WHERE NOT EXISTS (SELECT 1 FROM biz_system_settings WHERE setting_key = 'contract_expiry_warning_days');

INSERT INTO biz_system_settings (id, setting_key, setting_value, description, updated_by)
SELECT '00000000-0000-4000-8000-000000000502', 'order_import_max_rows', '200000', '订单文件最大数据行数（不含表头）', NULL
WHERE NOT EXISTS (SELECT 1 FROM biz_system_settings WHERE setting_key = 'order_import_max_rows');

INSERT INTO biz_system_settings (id, setting_key, setting_value, description, updated_by)
SELECT '00000000-0000-4000-8000-000000000503', 'order_import_max_bytes', '52428800', '订单文件最大字节数（50MB）', NULL
WHERE NOT EXISTS (SELECT 1 FROM biz_system_settings WHERE setting_key = 'order_import_max_bytes');
