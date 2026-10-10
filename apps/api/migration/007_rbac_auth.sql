-- V3.1 RBAC and authentication revocation foundation.
-- MySQL production path. SQLite compatibility is implemented by scripts/db/migrate.mjs.

ALTER TABLE users
  ADD COLUMN auth_version INT NOT NULL DEFAULT 1,
  ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN root_admin_singleton TINYINT
    GENERATED ALWAYS AS (CASE WHEN role = 'root_admin' THEN 1 ELSE NULL END) STORED;

CREATE UNIQUE INDEX uk_users_single_root_admin ON users (root_admin_singleton);

CREATE TABLE auth_wechat_invitations (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT NOT NULL,
  token_hash VARCHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME NULL,
  created_by BIGINT NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_auth_wechat_invitation_token_hash (token_hash),
  KEY idx_auth_wechat_invitation_user (user_id),
  KEY idx_auth_wechat_invitation_expiry (expires_at, used_at),
  CONSTRAINT fk_auth_wechat_invitation_user FOREIGN KEY (user_id) REFERENCES users (id),
  CONSTRAINT fk_auth_wechat_invitation_creator FOREIGN KEY (created_by) REFERENCES users (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
