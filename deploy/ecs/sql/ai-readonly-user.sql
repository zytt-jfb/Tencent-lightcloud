-- ============================================================================
-- AI 查数模块 · 只读账号（生产手动执行，脚本不会自动跑）
-- ============================================================================
-- 目的：给 AI 模块一个「只能读 8 张业务表」的账号。
--       TypeORM 主数据源用的 DB_USERNAME 有写权限，AI 不能复用它 ——
--       哪怕代码护栏有漏洞，DB 层也要能拒掉写操作与越权读。
--
-- 执行方式（在 MySQL 容器里，root 身份）：
--   docker exec -it biz-reporting-mysql-1 mysql -uroot -p
--   source /path/to/ai-readonly-user.sql
--
-- 重要：下面的库名按线上实际库名写死为 biz_restore_20261015。
--       如果你在别的环境执行（例如 biz_reporting），把库名全局替换掉再跑。
--       密码必须替换成随机强口令，并把同一份口令写进服务器 .env 的 READONLY_DSN。
-- ============================================================================

-- 1) 建账号（只允许从容器网络访问；如需限定来源主机，把 '%' 换成 '172.%'）
CREATE USER IF NOT EXISTS 'ai_ro'@'%' IDENTIFIED BY 'CHANGE_ME_STRONG_PASSWORD';

-- 2) 只授 8 张表的 SELECT。
--    刻意不含：biz_users / biz_roles / biz_permissions / biz_user_roles /
--              biz_user_permission_overrides / biz_user_scope_grants / biz_*_token
--    这些表与业务查数无关，AI 没有任何理由读它们。
GRANT SELECT ON biz_restore_20261015.biz_assessment_record         TO 'ai_ro'@'%';
GRANT SELECT ON biz_restore_20261015.biz_assessment_batch          TO 'ai_ro'@'%';
GRANT SELECT ON biz_restore_20261015.biz_performance_record        TO 'ai_ro'@'%';
GRANT SELECT ON biz_restore_20261015.biz_cities                    TO 'ai_ro'@'%';
GRANT SELECT ON biz_restore_20261015.biz_provinces                 TO 'ai_ro'@'%';
GRANT SELECT ON biz_restore_20261015.biz_cost_entries              TO 'ai_ro'@'%';
GRANT SELECT ON biz_restore_20261015.biz_cost_categories           TO 'ai_ro'@'%';
GRANT SELECT ON biz_restore_20261015.biz_contracts                 TO 'ai_ro'@'%';
GRANT SELECT ON biz_restore_20261015.biz_contract_city_allocations TO 'ai_ro'@'%';
GRANT SELECT ON biz_restore_20261015.biz_monthly_aggregates        TO 'ai_ro'@'%';

FLUSH PRIVILEGES;

-- ============================================================================
-- 3) 验收（必须自己跑一遍，三条都要「按预期失败/通过」）
-- ============================================================================
-- SHOW GRANTS FOR 'ai_ro'@'%';
--   期望：只有上面这些 SELECT，没有 ALL PRIVILEGES，没有 *.*
--
-- 用 ai_ro 登录后：
--   SELECT COUNT(*) FROM biz_assessment_record;            -- 期望：成功
--   SELECT COUNT(*) FROM biz_users;                        -- 期望：ERROR 1142 拒绝
--   SELECT COUNT(*) FROM mysql.user;                       -- 期望：ERROR 1142 拒绝
--   INSERT INTO biz_cost_entries (id) VALUES ('x');        -- 期望：ERROR 1142 拒绝
--
-- 4) 回滚（AI 模块下线时）
--   REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'ai_ro'@'%';
--   DROP USER 'ai_ro'@'%';
--   然后把 .env 的 READONLY_DSN 清空并重启 api —— AI 接口会返回「未配置」，主站不受影响。
-- ============================================================================
