-- Default configuration for scheduled business-analysis snapshot updates.
-- Idempotent for fresh databases and environments upgraded from earlier releases.

SET NAMES utf8mb4;

INSERT INTO biz_system_settings (id, setting_key, setting_value, description, updated_by)
SELECT '00000000-0000-4000-8000-000000000504', 'snapshot_auto_update_enabled', 'false', 'Enable scheduled business-analysis snapshot updates', NULL
WHERE NOT EXISTS (SELECT 1 FROM biz_system_settings WHERE setting_key = 'snapshot_auto_update_enabled');

INSERT INTO biz_system_settings (id, setting_key, setting_value, description, updated_by)
SELECT '00000000-0000-4000-8000-000000000505', 'snapshot_auto_update_time', '03:00', 'Scheduled business-analysis snapshot update time (HH:mm)', NULL
WHERE NOT EXISTS (SELECT 1 FROM biz_system_settings WHERE setting_key = 'snapshot_auto_update_time');
