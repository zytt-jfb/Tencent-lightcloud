-- 维护组织层级：省份 -> 地市 -> 区县。org_region 保留为区县字段。
-- 地市允许为空，历史记录由业务人员核实后补录，不从区县猜测地市。
ALTER TABLE maintenance_personnel ADD COLUMN org_city VARCHAR(160) NULL;
ALTER TABLE maintenance_vehicles ADD COLUMN org_city VARCHAR(160) NULL;
ALTER TABLE maintenance_generators ADD COLUMN org_city VARCHAR(160) NULL;
