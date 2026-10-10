-- ============================================================================
-- 维护管理经营数据中台（新基线）— 034：人员/车辆/油机明细字段补全
-- 版本：034_maintenance_detail_fields
-- 说明：按《9月份合并汇总》三张表补全人员证件与保险、车辆证照与保险、
--       油机厂家与保养字段，供维护列表二级弹窗完整展示。
--       仅追加列，不改动既有表结构与迁移；新列均可空，不影响存量数据。
--       每个 ADD COLUMN 单独成句，以兼容 SQLite（不支持一次多列与 COMMENT）。
-- ============================================================================

SET NAMES utf8mb4;

-- ---------- 人员：证件与保险 ----------
ALTER TABLE maintenance_personnel ADD COLUMN id_card VARCHAR(32) NULL;
ALTER TABLE maintenance_personnel ADD COLUMN low_voltage_cert VARCHAR(160) NULL;
ALTER TABLE maintenance_personnel ADD COLUMN low_voltage_cert_expiry VARCHAR(64) NULL;
ALTER TABLE maintenance_personnel ADD COLUMN high_voltage_cert VARCHAR(160) NULL;
ALTER TABLE maintenance_personnel ADD COLUMN high_voltage_cert_expiry VARCHAR(64) NULL;
ALTER TABLE maintenance_personnel ADD COLUMN work_at_height_cert VARCHAR(160) NULL;
ALTER TABLE maintenance_personnel ADD COLUMN work_at_height_cert_expiry VARCHAR(64) NULL;
ALTER TABLE maintenance_personnel ADD COLUMN employer_liability_amount VARCHAR(64) NULL;
ALTER TABLE maintenance_personnel ADD COLUMN employer_liability_policy_no VARCHAR(160) NULL;
ALTER TABLE maintenance_personnel ADD COLUMN employer_liability_expiry VARCHAR(64) NULL;
ALTER TABLE maintenance_personnel ADD COLUMN team_accident_amount VARCHAR(64) NULL;
ALTER TABLE maintenance_personnel ADD COLUMN team_accident_policy_no VARCHAR(160) NULL;
ALTER TABLE maintenance_personnel ADD COLUMN team_accident_expiry VARCHAR(64) NULL;
ALTER TABLE maintenance_personnel ADD COLUMN team_accident_amount2 VARCHAR(64) NULL;
ALTER TABLE maintenance_personnel ADD COLUMN team_accident_policy_no2 VARCHAR(160) NULL;
ALTER TABLE maintenance_personnel ADD COLUMN team_accident_expiry2 VARCHAR(64) NULL;
ALTER TABLE maintenance_personnel ADD COLUMN team_accident_amount3 VARCHAR(64) NULL;
ALTER TABLE maintenance_personnel ADD COLUMN team_accident_policy_no3 VARCHAR(160) NULL;
ALTER TABLE maintenance_personnel ADD COLUMN team_accident_expiry3 VARCHAR(64) NULL;
ALTER TABLE maintenance_personnel ADD COLUMN personnel_condition VARCHAR(255) NULL;

-- ---------- 车辆：证照、保险与运行 ----------
ALTER TABLE maintenance_vehicles ADD COLUMN owner_name VARCHAR(100) NULL;
ALTER TABLE maintenance_vehicles ADD COLUMN driving_license VARCHAR(160) NULL;
ALTER TABLE maintenance_vehicles ADD COLUMN vehicle_years VARCHAR(64) NULL;
ALTER TABLE maintenance_vehicles ADD COLUMN mileage VARCHAR(64) NULL;
ALTER TABLE maintenance_vehicles ADD COLUMN vehicle_status VARCHAR(64) NULL;
ALTER TABLE maintenance_vehicles ADD COLUMN compulsory_insurance_policy_no VARCHAR(160) NULL;
ALTER TABLE maintenance_vehicles ADD COLUMN compulsory_insurance_expiry VARCHAR(64) NULL;
ALTER TABLE maintenance_vehicles ADD COLUMN commercial_insurance_policy_no VARCHAR(160) NULL;
ALTER TABLE maintenance_vehicles ADD COLUMN commercial_insurance_expiry VARCHAR(64) NULL;
ALTER TABLE maintenance_vehicles ADD COLUMN maintenance_time VARCHAR(64) NULL;

-- ---------- 油机：厂家与保养 ----------
ALTER TABLE maintenance_generators ADD COLUMN manufacturer VARCHAR(255) NULL;
ALTER TABLE maintenance_generators ADD COLUMN production_date VARCHAR(64) NULL;
ALTER TABLE maintenance_generators ADD COLUMN last_maintenance_upload_at VARCHAR(64) NULL;

