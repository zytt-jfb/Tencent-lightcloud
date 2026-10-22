-- ============================================================================
-- 048_biz_user_preferences —— 用户级偏好（跨设备同步）
-- 约束：只追加，不修改历史迁移；可重复执行
--
-- 为什么需要这张表：
--   工作台的待办类别选择原先存在浏览器 localStorage，换电脑/清缓存就丢。
--   这里落一张通用的用户偏好表（user_id + pref_key 唯一），
--   本次只存 workbench.todo_keys；后续其它「每人一份」的界面偏好可直接复用，
--   不必每加一个偏好就再加一张表。
--
-- 与权限的关系（不要混淆）：
--   · 偏好只是展示选择，不授予任何权限
--   · 能选哪些待办类别，仍由后端按 permissionCodes 决定返回哪些项
--   · 读写都限定在 auth.userId，接口不接受他人 user_id
-- ============================================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS biz_user_preferences (
  user_id VARCHAR(36) NOT NULL,
  pref_key VARCHAR(64) NOT NULL,
  pref_value TEXT NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, pref_key)
);
