-- 025：经营端消息中心与公告
SET NAMES utf8mb4;

CREATE TABLE biz_announcements (
  id VARCHAR(36) PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  content TEXT NOT NULL,
  link_url VARCHAR(500) NULL,
  audience_type VARCHAR(16) NOT NULL DEFAULT 'province',
  province_id VARCHAR(36) NULL,
  city_id VARCHAR(36) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  publish_at DATETIME NULL,
  expires_at DATETIME NULL,
  created_by VARCHAR(36) NOT NULL,
  published_by VARCHAR(36) NULL,
  withdrawn_by VARCHAR(36) NULL,
  withdrawn_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
CREATE INDEX idx_biz_announcement_status_time ON biz_announcements (status, publish_at, expires_at);
CREATE INDEX idx_biz_announcement_scope ON biz_announcements (audience_type, province_id, city_id);
CREATE INDEX idx_biz_announcement_creator ON biz_announcements (created_by, status);

CREATE TABLE biz_announcement_reads (
  id VARCHAR(36) PRIMARY KEY,
  announcement_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36) NOT NULL,
  read_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX uk_biz_announcement_read ON biz_announcement_reads (announcement_id, user_id);
CREATE INDEX idx_biz_announcement_read_user ON biz_announcement_reads (user_id, read_at);

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000501', 'operation.message.read', '查看消息中心', '00000000-0000-4000-8000-000000000020', 'read'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.message.read');
INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000502', 'operation.announcement.create', '创建公告', '00000000-0000-4000-8000-000000000020', 'create'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.announcement.create');
INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000503', 'operation.announcement.publish', '发布公告', '00000000-0000-4000-8000-000000000020', 'publish'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.announcement.publish');
INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000504', 'operation.announcement.manage', '管理公告', '00000000-0000-4000-8000-000000000020', 'manage'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'operation.announcement.manage');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000511', '00000000-0000-4000-8000-000000000002', 'operation.message.read'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'operation.message.read');
INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000512', '00000000-0000-4000-8000-000000000002', 'operation.announcement.create'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'operation.announcement.create');
INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000513', '00000000-0000-4000-8000-000000000002', 'operation.announcement.publish'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'operation.announcement.publish');
INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000514', '00000000-0000-4000-8000-000000000002', 'operation.announcement.manage'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'operation.announcement.manage');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000515', '00000000-0000-4000-8000-000000000003', 'operation.message.read'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000003' AND permission_code = 'operation.message.read');
INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000516', '00000000-0000-4000-8000-000000000004', 'operation.message.read'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000004' AND permission_code = 'operation.message.read');
