-- 维护数据删除权限：默认不授予 admin / contract_manager，super_admin 由后端通配授权。
INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000936', 'maintenance.data.delete', '删除维护数据', '00000000-0000-4000-8000-000000000011', 'delete'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'maintenance.data.delete');
