-- ============================================================================
-- 041_biz_liaoning_regions —— 补充辽宁省及 14 个地市到省市字典
-- 背景：绩效数据打底表里含辽宁 1,087 行（14 个地市），字典只有山东 16 市 + 省本部，
--       导致这些行 city_id 为空、无法按地市筛选与做数据范围。
-- 约束：只追加，不改历史；可重复执行（WHERE NOT EXISTS）
-- 编码：按国家行政区划代码（辽宁省 210000，沈阳 210100 …）
-- ============================================================================

SET NAMES utf8mb4;

INSERT INTO biz_provinces (id, code, name, status)
SELECT '00000000-0000-4000-8000-000000000031', '210000', '辽宁省', 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_provinces WHERE code = '210000');

INSERT INTO biz_cities (id, province_id, code, name, status)
SELECT '00000000-0000-4000-8000-000000000240', '00000000-0000-4000-8000-000000000031', '210100', '沈阳市', 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_cities WHERE code = '210100');
INSERT INTO biz_cities (id, province_id, code, name, status)
SELECT '00000000-0000-4000-8000-000000000241', '00000000-0000-4000-8000-000000000031', '210200', '大连市', 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_cities WHERE code = '210200');
INSERT INTO biz_cities (id, province_id, code, name, status)
SELECT '00000000-0000-4000-8000-000000000242', '00000000-0000-4000-8000-000000000031', '210300', '鞍山市', 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_cities WHERE code = '210300');
INSERT INTO biz_cities (id, province_id, code, name, status)
SELECT '00000000-0000-4000-8000-000000000243', '00000000-0000-4000-8000-000000000031', '210400', '抚顺市', 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_cities WHERE code = '210400');
INSERT INTO biz_cities (id, province_id, code, name, status)
SELECT '00000000-0000-4000-8000-000000000244', '00000000-0000-4000-8000-000000000031', '210500', '本溪市', 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_cities WHERE code = '210500');
INSERT INTO biz_cities (id, province_id, code, name, status)
SELECT '00000000-0000-4000-8000-000000000245', '00000000-0000-4000-8000-000000000031', '210600', '丹东市', 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_cities WHERE code = '210600');
INSERT INTO biz_cities (id, province_id, code, name, status)
SELECT '00000000-0000-4000-8000-000000000246', '00000000-0000-4000-8000-000000000031', '210700', '锦州市', 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_cities WHERE code = '210700');
INSERT INTO biz_cities (id, province_id, code, name, status)
SELECT '00000000-0000-4000-8000-000000000247', '00000000-0000-4000-8000-000000000031', '210800', '营口市', 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_cities WHERE code = '210800');
INSERT INTO biz_cities (id, province_id, code, name, status)
SELECT '00000000-0000-4000-8000-000000000248', '00000000-0000-4000-8000-000000000031', '210900', '阜新市', 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_cities WHERE code = '210900');
INSERT INTO biz_cities (id, province_id, code, name, status)
SELECT '00000000-0000-4000-8000-000000000249', '00000000-0000-4000-8000-000000000031', '211000', '辽阳市', 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_cities WHERE code = '211000');
INSERT INTO biz_cities (id, province_id, code, name, status)
SELECT '00000000-0000-4000-8000-000000000250', '00000000-0000-4000-8000-000000000031', '211100', '盘锦市', 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_cities WHERE code = '211100');
INSERT INTO biz_cities (id, province_id, code, name, status)
SELECT '00000000-0000-4000-8000-000000000251', '00000000-0000-4000-8000-000000000031', '211200', '铁岭市', 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_cities WHERE code = '211200');
INSERT INTO biz_cities (id, province_id, code, name, status)
SELECT '00000000-0000-4000-8000-000000000252', '00000000-0000-4000-8000-000000000031', '211300', '朝阳市', 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_cities WHERE code = '211300');
INSERT INTO biz_cities (id, province_id, code, name, status)
SELECT '00000000-0000-4000-8000-000000000253', '00000000-0000-4000-8000-000000000031', '211400', '葫芦岛市', 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_cities WHERE code = '211400');
