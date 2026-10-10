-- 021：新增合同权限分组码并授予 admin / contract_manager
-- 来源：任务要求 operation.contract.{delete,batch_read,batch_create,batch_update,batch_delete,restore}
-- 说明：super_admin 由服务端通配 ALL（不依赖种子）；admin/contract_manager 默认拥有全部合同权限；
-- read/create/update/export/void/allocate/allocate_cancel/rate 已在 012 种子中，本迁移仅补齐本任务新增的 6 个码。

SET NAMES utf8mb4;

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000350', 'operation.contract.delete', '删除合同', '00000000-0000-4000-8000-000000000020', 'delete'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.contract.delete');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000351', 'operation.contract.batch_read', '批量查看合同', '00000000-0000-4000-8000-000000000020', 'batch_read'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.contract.batch_read');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000352', 'operation.contract.batch_create', '批量新增合同', '00000000-0000-4000-8000-000000000020', 'batch_create'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.contract.batch_create');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000353', 'operation.contract.batch_update', '批量修改合同', '00000000-0000-4000-8000-000000000020', 'batch_update'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.contract.batch_update');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000354', 'operation.contract.batch_delete', '批量删除合同', '00000000-0000-4000-8000-000000000020', 'batch_delete'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.contract.batch_delete');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000355', 'operation.contract.restore', '恢复合同', '00000000-0000-4000-8000-000000000020', 'restore'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.contract.restore');

-- admin（role 0002）默认拥有全部 6 个新合同权限
INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000460', '00000000-0000-4000-8000-000000000002', 'operation.contract.delete'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'operation.contract.delete');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000461', '00000000-0000-4000-8000-000000000002', 'operation.contract.batch_read'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'operation.contract.batch_read');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000462', '00000000-0000-4000-8000-000000000002', 'operation.contract.batch_create'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'operation.contract.batch_create');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000463', '00000000-0000-4000-8000-000000000002', 'operation.contract.batch_update'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'operation.contract.batch_update');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000464', '00000000-0000-4000-8000-000000000002', 'operation.contract.batch_delete'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'operation.contract.batch_delete');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000465', '00000000-0000-4000-8000-000000000002', 'operation.contract.restore'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'operation.contract.restore');

-- contract_manager（role 0003）默认拥有全部 6 个新合同权限
INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000470', '00000000-0000-4000-8000-000000000003', 'operation.contract.delete'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000003' AND permission_code = 'operation.contract.delete');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000471', '00000000-0000-4000-8000-000000000003', 'operation.contract.batch_read'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000003' AND permission_code = 'operation.contract.batch_read');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000472', '00000000-0000-4000-8000-000000000003', 'operation.contract.batch_create'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000003' AND permission_code = 'operation.contract.batch_create');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000473', '00000000-0000-4000-8000-000000000003', 'operation.contract.batch_update'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000003' AND permission_code = 'operation.contract.batch_update');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000474', '00000000-0000-4000-8000-000000000003', 'operation.contract.batch_delete'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000003' AND permission_code = 'operation.contract.batch_delete');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000475', '00000000-0000-4000-8000-000000000003', 'operation.contract.restore'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000003' AND permission_code = 'operation.contract.restore');
