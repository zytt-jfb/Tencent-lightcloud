-- 026：省市设置独立权限（读取接口仍沿用用户管理权限，写入操作使用本权限）
SET NAMES utf8mb4;

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000520', 'operation.region.manage', '维护省市设置', '00000000-0000-4000-8000-000000000020', 'manage'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.region.manage');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000521', '00000000-0000-4000-8000-000000000002', 'operation.region.manage'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'operation.region.manage');
