-- 省级直属经营单位 + 订单失败行修正批次
-- 仅做兼容性增量变更，不删除或覆盖既有订单数据。

ALTER TABLE biz_cities
  ADD COLUMN unit_type VARCHAR(32) NOT NULL DEFAULT 'city';

INSERT INTO biz_cities (id, province_id, code, name, unit_type, status)
SELECT '00000000-0000-4000-8000-000000000117', '00000000-0000-4000-8000-000000000030', '370000-BRANCH', '山东省分公司', 'province_branch', 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_cities WHERE code = '370000-BRANCH');

INSERT INTO biz_city_aliases (id, city_id, alias)
SELECT '00000000-0000-4000-8000-000000000181', '00000000-0000-4000-8000-000000000117', '山东省分公司'
WHERE NOT EXISTS (SELECT 1 FROM biz_city_aliases WHERE city_id = '00000000-0000-4000-8000-000000000117' AND alias = '山东省分公司');
INSERT INTO biz_city_aliases (id, city_id, alias)
SELECT '00000000-0000-4000-8000-000000000182', '00000000-0000-4000-8000-000000000117', '山东分公司'
WHERE NOT EXISTS (SELECT 1 FROM biz_city_aliases WHERE city_id = '00000000-0000-4000-8000-000000000117' AND alias = '山东分公司');
INSERT INTO biz_city_aliases (id, city_id, alias)
SELECT '00000000-0000-4000-8000-000000000183', '00000000-0000-4000-8000-000000000117', '山东省公司'
WHERE NOT EXISTS (SELECT 1 FROM biz_city_aliases WHERE city_id = '00000000-0000-4000-8000-000000000117' AND alias = '山东省公司');
INSERT INTO biz_city_aliases (id, city_id, alias)
SELECT '00000000-0000-4000-8000-000000000184', '00000000-0000-4000-8000-000000000117', '省公司'
WHERE NOT EXISTS (SELECT 1 FROM biz_city_aliases WHERE city_id = '00000000-0000-4000-8000-000000000117' AND alias = '省公司');
INSERT INTO biz_city_aliases (id, city_id, alias)
SELECT '00000000-0000-4000-8000-000000000185', '00000000-0000-4000-8000-000000000117', '省本部'
WHERE NOT EXISTS (SELECT 1 FROM biz_city_aliases WHERE city_id = '00000000-0000-4000-8000-000000000117' AND alias = '省本部');

ALTER TABLE biz_order_import_batches
  ADD COLUMN source_batch_id VARCHAR(36) NULL;
ALTER TABLE biz_order_import_batches
  ADD COLUMN batch_purpose VARCHAR(16) NOT NULL DEFAULT 'normal';
CREATE INDEX idx_biz_order_batch_source ON biz_order_import_batches (source_batch_id);

ALTER TABLE biz_order_rows
  ADD COLUMN replaces_order_row_id VARCHAR(36) NULL;
ALTER TABLE biz_order_rows
  ADD COLUMN resolved_by_batch_id VARCHAR(36) NULL;
ALTER TABLE biz_order_rows
  ADD COLUMN resolved_by_user_id VARCHAR(36) NULL;
ALTER TABLE biz_order_rows
  ADD COLUMN resolved_at DATETIME NULL;
CREATE INDEX idx_biz_order_row_replaces ON biz_order_rows (replaces_order_row_id);
CREATE UNIQUE INDEX uk_biz_order_row_replaces ON biz_order_rows (replaces_order_row_id);
CREATE INDEX idx_biz_order_row_resolved_batch ON biz_order_rows (resolved_by_batch_id);
