-- 047：收回 contract_manager 的成本权限（修复 019 误授权导致的死入口）
-- 背景：019 给 contract_manager 授了整组 operation.cost.*，但 contract_manager 的数据范围是
--       contract（按合同维度），而 biz-cost / biz-offline-completion / biz-aggregate 的
--       assertCityAccess / applyAggScope 对 contract scope 一律返回 403。
--       结果是导航和工作台显示「地市成本」入口，点进去必然 403，成本待办卡片也永远报错。
-- 处理：删除角色默认授权；同时删除账号级例外里指向成本权限的 allow 覆盖，
--       避免「角色收回了、个别账号还被例外开着」的残留。
-- 影响：contract_manager 不再看到地市成本入口与成本待办卡片；其余角色不受影响。

SET NAMES utf8mb4;

DELETE rp FROM biz_role_permissions rp
JOIN biz_roles r ON r.id = rp.role_id
WHERE r.code = 'contract_manager'
  AND rp.permission_code LIKE 'operation.cost.%';

DELETE o FROM biz_user_permission_overrides o
JOIN biz_user_roles ur ON ur.user_id = o.user_id AND ur.is_primary = 1
WHERE ur.role_code = 'contract_manager'
  AND o.effect = 'allow'
  AND o.permission_code LIKE 'operation.cost.%';
