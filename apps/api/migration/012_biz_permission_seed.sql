-- ============================================================================
-- 维护管理经营数据中台（新基线）— M2 账号与权限 012：权限点与四角色默认权限种子
-- 版本：012_biz_permission_seed
-- 来源：02-角色与权限矩阵-v1.1 TABLE 2-7 + 06 页面信息架构
-- 说明：super_admin 由服务端通配 ALL（不依赖种子）；其余角色默认权限见 ROLE_DEFAULT_PERMISSIONS。
-- ============================================================================

SET NAMES utf8mb4;

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000301', 'portal.engineering.enter', '进入工程管理', '00000000-0000-4000-8000-000000000010', 'enter'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'portal.engineering.enter');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000302', 'portal.maintenance.enter', '进入维护管理', '00000000-0000-4000-8000-000000000011', 'enter'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'portal.maintenance.enter');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000303', 'maintenance.operation.enter', '进入经营管理', '00000000-0000-4000-8000-000000000020', 'enter'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'maintenance.operation.enter');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000304', 'maintenance.asset.enter', '进入资产管理', '00000000-0000-4000-8000-000000000021', 'enter'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'maintenance.asset.enter');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000305', 'maintenance.personnel.enter', '进入人员管理', '00000000-0000-4000-8000-000000000022', 'enter'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'maintenance.personnel.enter');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000306', 'operation.home.read', '经营首页', '00000000-0000-4000-8000-000000000020', 'read'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.home.read');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000307', 'operation.analysis.read', '经营分析', '00000000-0000-4000-8000-000000000020', 'read'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.analysis.read');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000308', 'operation.contract.read', '查看合同', '00000000-0000-4000-8000-000000000020', 'read'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.contract.read');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000309', 'operation.contract.create', '新增合同', '00000000-0000-4000-8000-000000000020', 'create'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.contract.create');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000310', 'operation.contract.update', '编辑合同', '00000000-0000-4000-8000-000000000020', 'update'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.contract.update');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000311', 'operation.contract.void', '作废/恢复合同', '00000000-0000-4000-8000-000000000020', 'void'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.contract.void');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000312', 'operation.contract.allocate', '分配地市', '00000000-0000-4000-8000-000000000020', 'allocate'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.contract.allocate');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000313', 'operation.contract.allocate_cancel', '取消地市分配', '00000000-0000-4000-8000-000000000020', 'allocate_cancel'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.contract.allocate_cancel');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000314', 'operation.contract.rate', '维护管理费率', '00000000-0000-4000-8000-000000000020', 'rate'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.contract.rate');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000315', 'operation.contract.export', '导出合同', '00000000-0000-4000-8000-000000000020', 'export'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.contract.export');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000316', 'operation.order.read', '查看订单', '00000000-0000-4000-8000-000000000020', 'read'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.order.read');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000317', 'operation.order.upload', '上传订单文件', '00000000-0000-4000-8000-000000000020', 'upload'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.order.upload');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000318', 'operation.order.batch_void', '订单批次作废', '00000000-0000-4000-8000-000000000020', 'batch_void'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.order.batch_void');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000319', 'operation.order.batch_restore', '订单批次恢复', '00000000-0000-4000-8000-000000000020', 'batch_restore'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.order.batch_restore');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000320', 'operation.order.export', '导出订单', '00000000-0000-4000-8000-000000000020', 'export'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.order.export');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000321', 'operation.completion.read', '查看线下完工', '00000000-0000-4000-8000-000000000020', 'read'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.completion.read');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000322', 'operation.completion.create', '新增线下完工', '00000000-0000-4000-8000-000000000020', 'create'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.completion.create');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000323', 'operation.completion.submit', '提交线下完工', '00000000-0000-4000-8000-000000000020', 'submit'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.completion.submit');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000324', 'operation.completion.approve', '审核通过线下完工', '00000000-0000-4000-8000-000000000020', 'approve'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.completion.approve');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000325', 'operation.completion.reject', '驳回线下完工', '00000000-0000-4000-8000-000000000020', 'reject'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.completion.reject');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000326', 'operation.completion.void', '作废线下完工', '00000000-0000-4000-8000-000000000020', 'void'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.completion.void');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000327', 'operation.completion.export', '导出线下完工', '00000000-0000-4000-8000-000000000020', 'export'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.completion.export');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000328', 'operation.cost.read', '查看成本', '00000000-0000-4000-8000-000000000020', 'read'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.cost.read');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000329', 'operation.cost.create', '新增成本', '00000000-0000-4000-8000-000000000020', 'create'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.cost.create');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000330', 'operation.cost.submit', '提交成本', '00000000-0000-4000-8000-000000000020', 'submit'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.cost.submit');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000331', 'operation.cost.approve', '审核通过成本', '00000000-0000-4000-8000-000000000020', 'approve'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.cost.approve');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000332', 'operation.cost.reject', '驳回成本', '00000000-0000-4000-8000-000000000020', 'reject'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.cost.reject');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000333', 'operation.cost.void', '作废成本', '00000000-0000-4000-8000-000000000020', 'void'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.cost.void');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000334', 'operation.cost.export', '导出成本', '00000000-0000-4000-8000-000000000020', 'export'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.cost.export');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000335', 'operation.user.manage', '用户管理', '00000000-0000-4000-8000-000000000020', 'manage'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.user.manage');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000336', 'operation.role.manage', '角色与权限管理', '00000000-0000-4000-8000-000000000020', 'manage'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.role.manage');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000337', 'operation.module.manage', '模块授权', '00000000-0000-4000-8000-000000000020', 'manage'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.module.manage');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000338', 'operation.settings.read', '查看系统设置', '00000000-0000-4000-8000-000000000020', 'read'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.settings.read');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000339', 'operation.settings.manage', '维护系统设置', '00000000-0000-4000-8000-000000000020', 'manage'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.settings.manage');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000401', '00000000-0000-4000-8000-000000000002', 'portal.engineering.enter'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'portal.engineering.enter');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000402', '00000000-0000-4000-8000-000000000002', 'portal.maintenance.enter'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'portal.maintenance.enter');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000403', '00000000-0000-4000-8000-000000000002', 'maintenance.operation.enter'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'maintenance.operation.enter');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000404', '00000000-0000-4000-8000-000000000002', 'operation.home.read'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'operation.home.read');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000405', '00000000-0000-4000-8000-000000000002', 'operation.analysis.read'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'operation.analysis.read');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000406', '00000000-0000-4000-8000-000000000002', 'operation.contract.read'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'operation.contract.read');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000407', '00000000-0000-4000-8000-000000000002', 'operation.contract.create'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'operation.contract.create');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000408', '00000000-0000-4000-8000-000000000002', 'operation.contract.update'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'operation.contract.update');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000409', '00000000-0000-4000-8000-000000000002', 'operation.contract.void'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'operation.contract.void');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000410', '00000000-0000-4000-8000-000000000002', 'operation.contract.allocate'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'operation.contract.allocate');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000411', '00000000-0000-4000-8000-000000000002', 'operation.contract.rate'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'operation.contract.rate');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000412', '00000000-0000-4000-8000-000000000002', 'operation.contract.export'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'operation.contract.export');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000413', '00000000-0000-4000-8000-000000000002', 'operation.order.read'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'operation.order.read');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000414', '00000000-0000-4000-8000-000000000002', 'operation.order.upload'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'operation.order.upload');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000415', '00000000-0000-4000-8000-000000000002', 'operation.order.export'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'operation.order.export');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000416', '00000000-0000-4000-8000-000000000002', 'operation.completion.read'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'operation.completion.read');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000417', '00000000-0000-4000-8000-000000000002', 'operation.completion.approve'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'operation.completion.approve');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000418', '00000000-0000-4000-8000-000000000002', 'operation.completion.reject'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'operation.completion.reject');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000419', '00000000-0000-4000-8000-000000000002', 'operation.completion.void'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'operation.completion.void');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000420', '00000000-0000-4000-8000-000000000002', 'operation.completion.export'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'operation.completion.export');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000421', '00000000-0000-4000-8000-000000000002', 'operation.cost.read'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'operation.cost.read');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000422', '00000000-0000-4000-8000-000000000002', 'operation.cost.export'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'operation.cost.export');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000423', '00000000-0000-4000-8000-000000000002', 'operation.settings.read'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'operation.settings.read');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000424', '00000000-0000-4000-8000-000000000003', 'portal.maintenance.enter'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000003' AND permission_code = 'portal.maintenance.enter');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000425', '00000000-0000-4000-8000-000000000003', 'maintenance.operation.enter'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000003' AND permission_code = 'maintenance.operation.enter');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000426', '00000000-0000-4000-8000-000000000003', 'operation.contract.read'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000003' AND permission_code = 'operation.contract.read');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000427', '00000000-0000-4000-8000-000000000003', 'operation.contract.create'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000003' AND permission_code = 'operation.contract.create');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000428', '00000000-0000-4000-8000-000000000003', 'operation.contract.update'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000003' AND permission_code = 'operation.contract.update');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000429', '00000000-0000-4000-8000-000000000003', 'operation.contract.void'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000003' AND permission_code = 'operation.contract.void');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000430', '00000000-0000-4000-8000-000000000003', 'operation.contract.allocate'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000003' AND permission_code = 'operation.contract.allocate');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000431', '00000000-0000-4000-8000-000000000003', 'operation.contract.rate'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000003' AND permission_code = 'operation.contract.rate');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000432', '00000000-0000-4000-8000-000000000003', 'operation.contract.export'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000003' AND permission_code = 'operation.contract.export');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000433', '00000000-0000-4000-8000-000000000004', 'portal.maintenance.enter'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000004' AND permission_code = 'portal.maintenance.enter');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000434', '00000000-0000-4000-8000-000000000004', 'maintenance.operation.enter'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000004' AND permission_code = 'maintenance.operation.enter');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000435', '00000000-0000-4000-8000-000000000004', 'operation.home.read'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000004' AND permission_code = 'operation.home.read');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000436', '00000000-0000-4000-8000-000000000004', 'operation.analysis.read'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000004' AND permission_code = 'operation.analysis.read');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000437', '00000000-0000-4000-8000-000000000004', 'operation.contract.read'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000004' AND permission_code = 'operation.contract.read');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000438', '00000000-0000-4000-8000-000000000004', 'operation.contract.export'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000004' AND permission_code = 'operation.contract.export');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000439', '00000000-0000-4000-8000-000000000004', 'operation.order.read'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000004' AND permission_code = 'operation.order.read');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000440', '00000000-0000-4000-8000-000000000004', 'operation.order.export'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000004' AND permission_code = 'operation.order.export');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000441', '00000000-0000-4000-8000-000000000004', 'operation.completion.read'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000004' AND permission_code = 'operation.completion.read');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000442', '00000000-0000-4000-8000-000000000004', 'operation.completion.create'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000004' AND permission_code = 'operation.completion.create');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000443', '00000000-0000-4000-8000-000000000004', 'operation.completion.submit'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000004' AND permission_code = 'operation.completion.submit');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000444', '00000000-0000-4000-8000-000000000004', 'operation.completion.export'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000004' AND permission_code = 'operation.completion.export');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000445', '00000000-0000-4000-8000-000000000004', 'operation.cost.read'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000004' AND permission_code = 'operation.cost.read');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000446', '00000000-0000-4000-8000-000000000004', 'operation.cost.create'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000004' AND permission_code = 'operation.cost.create');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000447', '00000000-0000-4000-8000-000000000004', 'operation.cost.submit'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000004' AND permission_code = 'operation.cost.submit');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000448', '00000000-0000-4000-8000-000000000004', 'operation.cost.export'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000004' AND permission_code = 'operation.cost.export');
