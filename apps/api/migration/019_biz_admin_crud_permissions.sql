-- 019：管理员角色对合同、订单、成本的完整单条/批量维护权限
-- 说明：super_admin 继续由服务端通配；本迁移只补齐 admin / contract_manager 默认权限。

SET NAMES utf8mb4;

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT UUID(), r.id, p.code
FROM biz_roles r
JOIN biz_permissions p ON p.code IN (
  'operation.contract.allocate_cancel',
  'operation.order.batch_void',
  'operation.order.batch_restore',
  'operation.cost.create',
  'operation.cost.submit',
  'operation.cost.approve',
  'operation.cost.reject',
  'operation.cost.void'
)
WHERE r.code = 'admin'
  AND NOT EXISTS (
    SELECT 1 FROM biz_role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_code = p.code
  );

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT UUID(), r.id, p.code
FROM biz_roles r
JOIN biz_permissions p ON p.code IN (
  'operation.order.read',
  'operation.order.upload',
  'operation.order.batch_void',
  'operation.order.batch_restore',
  'operation.order.export',
  'operation.cost.read',
  'operation.cost.create',
  'operation.cost.submit',
  'operation.cost.approve',
  'operation.cost.reject',
  'operation.cost.void',
  'operation.cost.export'
)
WHERE r.code = 'contract_manager'
  AND NOT EXISTS (
    SELECT 1 FROM biz_role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_code = p.code
  );
