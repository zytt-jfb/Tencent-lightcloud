-- 029：账号角色与对象范围授权。旧字段仅用于一次性迁移，运行时由新表提供认证上下文。
SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS biz_user_roles (
  id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  role_code VARCHAR(32) NOT NULL,
  is_primary TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_biz_user_role (user_id, role_code),
  KEY idx_biz_user_role_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS biz_user_scope_grants (
  id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  scope_type VARCHAR(16) NOT NULL,
  target_id VARCHAR(36) NULL,
  effect VARCHAR(8) NOT NULL DEFAULT 'allow',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_biz_user_scope_grant (user_id, scope_type, target_id, effect),
  KEY idx_biz_user_scope_grant_user (user_id),
  KEY idx_biz_user_scope_grant_target (scope_type, target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO biz_user_roles (id, user_id, role_code, is_primary)
SELECT UUID(), u.id, u.role_code, 1 FROM biz_users u
WHERE NOT EXISTS (SELECT 1 FROM biz_user_roles r WHERE r.user_id = u.id AND r.role_code = u.role_code);

INSERT INTO biz_user_scope_grants (id, user_id, scope_type, target_id, effect)
SELECT UUID(), u.id, 'all', NULL, 'allow' FROM biz_users u
WHERE u.role_code = 'super_admin'
  AND NOT EXISTS (SELECT 1 FROM biz_user_scope_grants g WHERE g.user_id = u.id AND g.scope_type = 'all' AND g.effect = 'allow');

INSERT INTO biz_user_scope_grants (id, user_id, scope_type, target_id, effect)
SELECT UUID(), u.id, 'city', u.city_id, 'allow' FROM biz_users u
WHERE u.role_code = 'city_user' AND u.city_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM biz_user_scope_grants g WHERE g.user_id = u.id AND g.scope_type = 'city' AND g.target_id = u.city_id AND g.effect = 'allow');

INSERT INTO biz_user_scope_grants (id, user_id, scope_type, target_id, effect)
SELECT UUID(), s.user_id, CASE WHEN s.city_id IS NOT NULL THEN 'city' WHEN s.province_id IS NOT NULL THEN 'province' ELSE 'all' END,
  COALESCE(s.city_id, s.province_id), 'allow'
FROM biz_user_data_scopes s
JOIN biz_users u ON u.id = s.user_id
WHERE u.role_code = 'admin'
  AND NOT EXISTS (
    SELECT 1 FROM biz_user_scope_grants g
    WHERE g.user_id = s.user_id
      AND g.scope_type = CASE WHEN s.city_id IS NOT NULL THEN 'city' WHEN s.province_id IS NOT NULL THEN 'province' ELSE 'all' END
      AND ((g.target_id = COALESCE(s.city_id, s.province_id)) OR (g.target_id IS NULL AND s.city_id IS NULL AND s.province_id IS NULL))
      AND g.effect = 'allow'
  );

INSERT INTO biz_user_scope_grants (id, user_id, scope_type, target_id, effect)
SELECT UUID(), u.id, 'all', NULL, 'allow' FROM biz_users u
WHERE u.role_code = 'admin'
  AND NOT EXISTS (SELECT 1 FROM biz_user_scope_grants g WHERE g.user_id = u.id);
