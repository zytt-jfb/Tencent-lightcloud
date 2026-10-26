-- ============================================================================
-- 050_assistant_import_permission —— 批量导入独立授权
-- 约束：只追加，不修改历史迁移；所有语句可重复执行
--
-- 为什么单独开一个权限点：
--   批量导入一次能写入上百行，破坏力远大于单条新增。如果只按模块写权限放行，
--   任何能编辑一条记录的人都能借 AI 入口覆盖整张表。所以「能不能用批量导入」
--   独立成一个开关，由 admin 在权限管理里逐个账号授予。
--
-- 关键：本迁移**不给任何内置角色授予**该权限（不写 biz_role_permissions）。
--   admin / city_user / contract_manager 全部没有；super_admin 由服务端通配。
--   这是有意为之：默认谁都没有，必须人工点开。
--
-- 模块归属用「维护管理」(0011)：三类导入对象（人员/车辆/油机）都在这张模块下，
--   biz_modules 里没有独立的 ai 模块，不为一个权限点新造模块。
-- ============================================================================

SET NAMES utf8mb4;

INSERT INTO biz_permissions (id, code, name, module_id, action, portal_domain, dangerous)
SELECT '00000000-0000-4000-8000-000000000949',
       'assistant.import.execute',
       '批量导入（人员/资产/台账）',
       '00000000-0000-4000-8000-000000000011',
       'execute',
       'assistant',
       1
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'assistant.import.execute');

-- 防御性清理：历史上若有人误把该权限授予内置角色，这里显式收回。
-- （本次为首次引入，正常情况下影响 0 行；写在这里是为了让「默认不授予」成为可执行的约束，
--   而不是只写在注释里的口头约定。）
DELETE FROM biz_role_permissions
 WHERE permission_code = 'assistant.import.execute'
   AND role_id IN (
     SELECT id FROM biz_roles WHERE code IN ('admin', 'city_user', 'contract_manager')
   );
