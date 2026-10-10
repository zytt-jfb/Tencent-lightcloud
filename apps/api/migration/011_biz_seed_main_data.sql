-- ============================================================================
-- 维护管理经营数据中台（新基线）— 数据基础 011：主数据种子
-- 版本：011_biz_seed_main_data
-- 说明：
--   1. 种子使用 INSERT ... SELECT ... WHERE NOT EXISTS 保证 MySQL/SQLite 双兼容与幂等；
--   2. 固定 UUID（00000000-0000-4000-8000-0000000000xx）保证重复执行不产生重复行；
--   3. 首版预置山东省及其 16 个地市作为初始化主数据；模型支持多省扩展（不写死）；
--   4. 权限点在 M2（DEV-014/015 权限矩阵固化）追加，本迁移只建角色/模块骨架。
-- ============================================================================

SET NAMES utf8mb4;

-- ----------------------------
-- 1. 四类默认角色
-- ----------------------------
INSERT INTO biz_roles (id, code, name, is_builtin)
SELECT '00000000-0000-4000-8000-000000000001', 'super_admin', '超级管理员', 1
WHERE NOT EXISTS (SELECT 1 FROM biz_roles WHERE code = 'super_admin');

INSERT INTO biz_roles (id, code, name, is_builtin)
SELECT '00000000-0000-4000-8000-000000000002', 'admin', '省级运营管理员', 1
WHERE NOT EXISTS (SELECT 1 FROM biz_roles WHERE code = 'admin');

INSERT INTO biz_roles (id, code, name, is_builtin)
SELECT '00000000-0000-4000-8000-000000000003', 'contract_manager', '合同管理员', 1
WHERE NOT EXISTS (SELECT 1 FROM biz_roles WHERE code = 'contract_manager');

INSERT INTO biz_roles (id, code, name, is_builtin)
SELECT '00000000-0000-4000-8000-000000000004', 'city_user', '地市用户', 1
WHERE NOT EXISTS (SELECT 1 FROM biz_roles WHERE code = 'city_user');

-- ----------------------------
-- 2. 一级模块
-- ----------------------------
INSERT INTO biz_modules (id, code, name, level, parent_id, sort_order, status)
SELECT '00000000-0000-4000-8000-000000000010', 'engineering', '工程管理', 'level1', NULL, 1, 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_modules WHERE code = 'engineering');

INSERT INTO biz_modules (id, code, name, level, parent_id, sort_order, status)
SELECT '00000000-0000-4000-8000-000000000011', 'maintenance', '维护管理', 'level1', NULL, 2, 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_modules WHERE code = 'maintenance');

-- ----------------------------
-- 3. 维护管理二级模块
-- ----------------------------
INSERT INTO biz_modules (id, code, name, level, parent_id, sort_order, status)
SELECT '00000000-0000-4000-8000-000000000020', 'operation', '经营管理', 'level2', '00000000-0000-4000-8000-000000000011', 1, 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_modules WHERE code = 'operation');

INSERT INTO biz_modules (id, code, name, level, parent_id, sort_order, status)
SELECT '00000000-0000-4000-8000-000000000021', 'asset', '资产管理', 'level2', '00000000-0000-4000-8000-000000000011', 2, 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_modules WHERE code = 'asset');

INSERT INTO biz_modules (id, code, name, level, parent_id, sort_order, status)
SELECT '00000000-0000-4000-8000-000000000022', 'personnel', '人员管理', 'level2', '00000000-0000-4000-8000-000000000011', 3, 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_modules WHERE code = 'personnel');

-- ----------------------------
-- 4. 省份：山东省（首版初始化；模型支持多省扩展）
-- ----------------------------
INSERT INTO biz_provinces (id, code, name, status)
SELECT '00000000-0000-4000-8000-000000000030', '370000', '山东省', 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_provinces WHERE code = '370000');

-- ----------------------------
-- 5. 地市：山东省 16 个地市
-- ----------------------------
INSERT INTO biz_cities (id, province_id, code, name, status)
SELECT '00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000030', '370100', '济南市', 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_cities WHERE code = '370100');
INSERT INTO biz_cities (id, province_id, code, name, status)
SELECT '00000000-0000-4000-8000-000000000102', '00000000-0000-4000-8000-000000000030', '370200', '青岛市', 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_cities WHERE code = '370200');
INSERT INTO biz_cities (id, province_id, code, name, status)
SELECT '00000000-0000-4000-8000-000000000103', '00000000-0000-4000-8000-000000000030', '370300', '淄博市', 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_cities WHERE code = '370300');
INSERT INTO biz_cities (id, province_id, code, name, status)
SELECT '00000000-0000-4000-8000-000000000104', '00000000-0000-4000-8000-000000000030', '370400', '枣庄市', 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_cities WHERE code = '370400');
INSERT INTO biz_cities (id, province_id, code, name, status)
SELECT '00000000-0000-4000-8000-000000000105', '00000000-0000-4000-8000-000000000030', '370500', '东营市', 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_cities WHERE code = '370500');
INSERT INTO biz_cities (id, province_id, code, name, status)
SELECT '00000000-0000-4000-8000-000000000106', '00000000-0000-4000-8000-000000000030', '370600', '烟台市', 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_cities WHERE code = '370600');
INSERT INTO biz_cities (id, province_id, code, name, status)
SELECT '00000000-0000-4000-8000-000000000107', '00000000-0000-4000-8000-000000000030', '370700', '潍坊市', 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_cities WHERE code = '370700');
INSERT INTO biz_cities (id, province_id, code, name, status)
SELECT '00000000-0000-4000-8000-000000000108', '00000000-0000-4000-8000-000000000030', '370800', '济宁市', 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_cities WHERE code = '370800');
INSERT INTO biz_cities (id, province_id, code, name, status)
SELECT '00000000-0000-4000-8000-000000000109', '00000000-0000-4000-8000-000000000030', '370900', '泰安市', 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_cities WHERE code = '370900');
INSERT INTO biz_cities (id, province_id, code, name, status)
SELECT '00000000-0000-4000-8000-000000000110', '00000000-0000-4000-8000-000000000030', '371000', '威海市', 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_cities WHERE code = '371000');
INSERT INTO biz_cities (id, province_id, code, name, status)
SELECT '00000000-0000-4000-8000-000000000111', '00000000-0000-4000-8000-000000000030', '371100', '日照市', 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_cities WHERE code = '371100');
INSERT INTO biz_cities (id, province_id, code, name, status)
SELECT '00000000-0000-4000-8000-000000000112', '00000000-0000-4000-8000-000000000030', '371300', '临沂市', 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_cities WHERE code = '371300');
INSERT INTO biz_cities (id, province_id, code, name, status)
SELECT '00000000-0000-4000-8000-000000000113', '00000000-0000-4000-8000-000000000030', '371400', '德州市', 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_cities WHERE code = '371400');
INSERT INTO biz_cities (id, province_id, code, name, status)
SELECT '00000000-0000-4000-8000-000000000114', '00000000-0000-4000-8000-000000000030', '371500', '聊城市', 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_cities WHERE code = '371500');
INSERT INTO biz_cities (id, province_id, code, name, status)
SELECT '00000000-0000-4000-8000-000000000115', '00000000-0000-4000-8000-000000000030', '371600', '滨州市', 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_cities WHERE code = '371600');
INSERT INTO biz_cities (id, province_id, code, name, status)
SELECT '00000000-0000-4000-8000-000000000116', '00000000-0000-4000-8000-000000000030', '371700', '菏泽市', 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_cities WHERE code = '371700');

-- ----------------------------
-- 6. 成本分类字典（7 类）
-- ----------------------------
INSERT INTO biz_cost_categories (id, code, name, status, sort_order)
SELECT '00000000-0000-4000-8000-000000000201', 'labor', '人工成本', 'active', 1
WHERE NOT EXISTS (SELECT 1 FROM biz_cost_categories WHERE code = 'labor');
INSERT INTO biz_cost_categories (id, code, name, status, sort_order)
SELECT '00000000-0000-4000-8000-000000000202', 'utilities', '水电费', 'active', 2
WHERE NOT EXISTS (SELECT 1 FROM biz_cost_categories WHERE code = 'utilities');
INSERT INTO biz_cost_categories (id, code, name, status, sort_order)
SELECT '00000000-0000-4000-8000-000000000203', 'fuel', '油补', 'active', 3
WHERE NOT EXISTS (SELECT 1 FROM biz_cost_categories WHERE code = 'fuel');
INSERT INTO biz_cost_categories (id, code, name, status, sort_order)
SELECT '00000000-0000-4000-8000-000000000204', 'entertainment', '招待费', 'active', 4
WHERE NOT EXISTS (SELECT 1 FROM biz_cost_categories WHERE code = 'entertainment');
INSERT INTO biz_cost_categories (id, code, name, status, sort_order)
SELECT '00000000-0000-4000-8000-000000000205', 'rent', '房租', 'active', 5
WHERE NOT EXISTS (SELECT 1 FROM biz_cost_categories WHERE code = 'rent');
INSERT INTO biz_cost_categories (id, code, name, status, sort_order)
SELECT '00000000-0000-4000-8000-000000000206', 'reimbursement', '报销', 'active', 6
WHERE NOT EXISTS (SELECT 1 FROM biz_cost_categories WHERE code = 'reimbursement');
INSERT INTO biz_cost_categories (id, code, name, status, sort_order)
SELECT '00000000-0000-4000-8000-000000000207', 'other', '其他', 'active', 7
WHERE NOT EXISTS (SELECT 1 FROM biz_cost_categories WHERE code = 'other');
