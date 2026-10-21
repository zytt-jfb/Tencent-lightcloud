-- ============================================================================
-- 046_maintenance_data_write —— 维护数据「新增/编辑」权限点
-- 约束：只追加，不修改历史迁移；所有语句可重复执行
--
-- 为什么需要这一条：
--   maintenance 三个 controller 的 create / update 原先只挂 @UseGuards(BizAuthGuard)，
--   **没有 @BizPermissions** —— 任何登录账号（含 contract_manager）都能改任意维护数据；
--   只有 remove 挂了 maintenance.data.delete。多角色使用前必须补上「能不能写」这一层。
--
-- 与数据范围的分工（不要合并）：
--   · maintenance.data.write 只回答「能不能写」
--   · 能写哪个地市由 MaintenanceScopeService.assertWritable 按账号数据范围判定，
--     city_user 因此只能改本市记录，改动地市到范围外同样 403
--   · 未授予本权限点的角色（contract_manager）只能看，不能增改
-- ============================================================================

SET NAMES utf8mb4;

-- ----------------------------
-- 1. 权限点（模块归属：维护管理 = ...0011）
-- ----------------------------
INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000946', 'maintenance.data.write', '维护数据新增/编辑', '00000000-0000-4000-8000-000000000011', 'write'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'maintenance.data.write');

-- ----------------------------
-- 2. 角色默认授权
--    admin（省级运营管理员）、city_user（地市用户）→ 授予，范围由数据范围收敛
--    contract_manager → 不授予（合同角色不应改人员资质）
--    super_admin → 服务端通配，不依赖种子
-- ----------------------------
INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000956', '00000000-0000-4000-8000-000000000002', 'maintenance.data.write'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'maintenance.data.write');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000957', '00000000-0000-4000-8000-000000000004', 'maintenance.data.write'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000004' AND permission_code = 'maintenance.data.write');

-- ----------------------------
-- 3. 明细页进入权限（区分人员 / 资产）
--    maintenance.operation.enter 现在 admin / city_user / contract_manager 三者都有，
--    而它同时被经营管理页面复用，不能收窄。所以明细页改用更细的两个已有权限点：
--      personnel.enter → 人员管理（并约束 /biz/maintenance/personnel 接口）
--      asset.enter     → 车辆 / 油机管理（并约束对应接口）
--    contract_manager 不授予 → 看不到维护明细，只能看数据总览（无记录级数据）
-- ----------------------------
INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000958', '00000000-0000-4000-8000-000000000002', 'maintenance.personnel.enter'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'maintenance.personnel.enter');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000959', '00000000-0000-4000-8000-000000000002', 'maintenance.asset.enter'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'maintenance.asset.enter');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000960', '00000000-0000-4000-8000-000000000004', 'maintenance.personnel.enter'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000004' AND permission_code = 'maintenance.personnel.enter');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000961', '00000000-0000-4000-8000-000000000004', 'maintenance.asset.enter'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000004' AND permission_code = 'maintenance.asset.enter');
