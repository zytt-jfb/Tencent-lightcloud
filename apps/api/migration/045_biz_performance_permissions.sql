-- ============================================================================
-- 045_biz_performance_permissions —— 月度考核权限点 + 维护敏感字段权限
-- 约束：只追加，不修改历史迁移；所有语句可重复执行
--
-- 口径说明（不要在这里合并算法）：
--   · 月度考核与后评估是两套数据、两套算法，本迁移只加权限点，不动表结构
--   · performance.upload.* 不授予任何业务角色：后端 ensureUpload 原本就是「仅超管」，
--     现在用权限点表达同一约束，非超管因此看不到「绩效上传」菜单
--   · performance.overview.* 授予 admin 与 city_user：地市账号的数据范围由
--     performance.service 按「地市名称」过滤（原实现用 city UUID LIKE 中文列，永远查不到）
--   · maintenance.sensitive.read 控制身份证 / 手机号明文；未授予者读到的是掩码格式
-- ============================================================================

SET NAMES utf8mb4;

-- ----------------------------
-- 1. 权限点（模块归属：维护管理 = ...0011，月度考核挂在维护管理下）
-- ----------------------------
INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000941', 'performance.overview.read', '月度考核查看', '00000000-0000-4000-8000-000000000011', 'read'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'performance.overview.read');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000942', 'performance.overview.export', '月度考核导出', '00000000-0000-4000-8000-000000000011', 'export'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'performance.overview.export');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000943', 'performance.upload.read', '绩效上传批次查看', '00000000-0000-4000-8000-000000000011', 'read'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'performance.upload.read');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000944', 'performance.upload.create', '绩效数据上传', '00000000-0000-4000-8000-000000000011', 'upload'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'performance.upload.create');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000945', 'maintenance.sensitive.read', '维护数据敏感字段查看', '00000000-0000-4000-8000-000000000011', 'read'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'maintenance.sensitive.read');

-- ----------------------------
-- 2. 角色默认授权
--    admin（省级运营管理员）：月度考核查看/导出 + 维护敏感字段明文
--    city_user（地市用户）：月度考核查看/导出（数据范围按地市收敛）
--    contract_manager：不授予
--    super_admin：服务端通配，不依赖种子
--    performance.upload.*：不授予任何业务角色（仅超管）
-- ----------------------------
INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000951', '00000000-0000-4000-8000-000000000002', 'performance.overview.read'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'performance.overview.read');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000952', '00000000-0000-4000-8000-000000000002', 'performance.overview.export'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'performance.overview.export');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000953', '00000000-0000-4000-8000-000000000002', 'maintenance.sensitive.read'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'maintenance.sensitive.read');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000954', '00000000-0000-4000-8000-000000000004', 'performance.overview.read'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000004' AND permission_code = 'performance.overview.read');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000955', '00000000-0000-4000-8000-000000000004', 'performance.overview.export'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000004' AND permission_code = 'performance.overview.export');
