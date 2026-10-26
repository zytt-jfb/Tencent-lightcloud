-- ============================================================================
-- 049_biz_permission_metadata —— 权限架构精简（阶段 0+1）的元数据底座
-- 约束：只追加，不修改历史迁移；所有语句可重复执行
--
-- 本次只做「加东西」，不动任何既有权限数据、不改任何权限码：
--   1. biz_roles.role_type        —— 为阶段 2 的「个人角色替代账号例外」预留
--   2. biz_permissions.portal_domain —— 权限码 → 门户域 的归属（模块入口判定的唯一依据）
--   3. biz_permissions.dangerous  —— 危险操作标记（删除类），供界面二次确认与审计
--   4. biz_permission_aliases     —— 阶段 3 权限码改名时的映射表，本期留空
--
-- 为什么要 portal_domain 这一列，而不是直接按权限码前缀切：
--   现有码里 operation.* 同时横跨两个模块 —— operation.contract.read 属于经营管理，
--   operation.user.manage 属于系统设置；maintenance.operation.enter 名字带 maintenance，
--   语义却是「经营管理模块入口」。按字符串前缀推导会把模块入口判错。
--   因此把归属显式写进目录表，代码侧用同一份映射（shared-types DOMAIN_PERMISSIONS）校验。
--
-- portal.* 四个入口码的归属刻意保留（归各自模块）：
--   阶段 1 改判定方式但**不改变任何人的实际可见范围**，所以要保证「现在能进的，改后还能进」。
--   等阶段 3 改名删码时，这些归属会自然消失。
-- ============================================================================

SET NAMES utf8mb4;

-- ----------------------------
-- 1. 角色：内置 / 个人
-- ----------------------------
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'biz_roles' AND COLUMN_NAME = 'role_type');
SET @sql := IF(@exists = 0,
  'ALTER TABLE biz_roles ADD COLUMN role_type VARCHAR(16) NOT NULL DEFAULT ''builtin'' COMMENT ''builtin=内置角色；personal=个人角色（仅绑定 1 人）''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'biz_roles' AND COLUMN_NAME = 'description');
SET @sql := IF(@exists = 0,
  'ALTER TABLE biz_roles ADD COLUMN description VARCHAR(255) NULL COMMENT ''角色用途说明''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ----------------------------
-- 2. 权限目录：门户域归属 + 危险标记
-- ----------------------------
SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'biz_permissions' AND COLUMN_NAME = 'portal_domain');
SET @sql := IF(@exists = 0,
  'ALTER TABLE biz_permissions ADD COLUMN portal_domain VARCHAR(32) NOT NULL DEFAULT '''' COMMENT ''门户域：engineering/maintenance/operation/system/assistant''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists := (SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'biz_permissions' AND COLUMN_NAME = 'dangerous');
SET @sql := IF(@exists = 0,
  'ALTER TABLE biz_permissions ADD COLUMN dangerous TINYINT(1) NOT NULL DEFAULT 0 COMMENT ''1=危险操作（删除类）''',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ----------------------------
-- 3. 权限码改名映射（阶段 3 使用，本期不填数据）
-- ----------------------------
CREATE TABLE IF NOT EXISTS biz_permission_aliases (
  old_code VARCHAR(128) NOT NULL,
  new_code VARCHAR(128) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (old_code)
);

-- ----------------------------
-- 4. 回填 portal_domain
--    顺序要紧：先处理跨模块的 operation.* 特例，再兜底整段前缀
-- ----------------------------
UPDATE biz_permissions SET portal_domain = 'engineering'
 WHERE code LIKE 'assessment.%' AND portal_domain = '';

UPDATE biz_permissions SET portal_domain = 'maintenance'
 WHERE (code LIKE 'maintenance.%' OR code LIKE 'performance.%') AND portal_domain = '';

-- 系统管理：这些 operation.* 实际属于「系统设置」模块，不是经营管理
-- 注意 operation.message.read 刻意**不在**这里：消息是全员功能（contract_manager 也有），
-- 若归 system 域，任何能看消息的账号都会拿到「系统设置」模块入口。
UPDATE biz_permissions SET portal_domain = 'system'
 WHERE code IN (
   'operation.user.manage', 'operation.role.manage', 'operation.module.manage',
   'operation.settings.read', 'operation.settings.manage', 'operation.region.manage',
   'operation.announcement.create', 'operation.announcement.publish', 'operation.announcement.manage'
 ) AND portal_domain = '';

-- 其余 operation.* 归经营管理
UPDATE biz_permissions SET portal_domain = 'operation'
 WHERE code LIKE 'operation.%' AND portal_domain = '';

-- 门户入口码：刻意保留归属，保证阶段 1 的可见范围与改造前完全一致
UPDATE biz_permissions SET portal_domain = 'engineering' WHERE code = 'portal.engineering.enter' AND portal_domain = '';
UPDATE biz_permissions SET portal_domain = 'maintenance' WHERE code = 'portal.maintenance.enter' AND portal_domain = '';
UPDATE biz_permissions SET portal_domain = 'system'      WHERE code = 'portal.system.enter'      AND portal_domain = '';

-- ----------------------------
-- 5. 两个新权限码（数据删除台账）：只进目录，不授予任何角色
--    现状：/api/biz/admin/data/* 仅要求 portal.system.enter，而没有任何角色持有该码，
--    实际只有 super_admin 靠通配可用，且 service 内部再校验 isSuperAdmin。
--    补上专用权限码后，这层保护从「靠路径前缀」变成「显式声明」，能力范围不变。
-- ----------------------------
INSERT INTO biz_permissions (id, code, name, module_id, action, portal_domain, dangerous)
SELECT '00000000-0000-4000-8000-000000000947', 'system.data.read', '数据删除台账查看',
       '00000000-0000-4000-8000-000000000011', 'read', 'system', 0
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'system.data.read');

INSERT INTO biz_permissions (id, code, name, module_id, action, portal_domain, dangerous)
SELECT '00000000-0000-4000-8000-000000000948', 'system.data.delete', '数据删除执行（危险）',
       '00000000-0000-4000-8000-000000000011', 'delete', 'system', 1
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'system.data.delete');

-- ----------------------------
-- 6. 危险标记回填（已有的删除类权限点）
-- ----------------------------
UPDATE biz_permissions SET dangerous = 1
 WHERE code IN (
   'maintenance.data.delete',
   'assessment.import.delete',
   'operation.contract.delete', 'operation.contract.batch_delete', 'operation.contract.void',
   'operation.completion.void', 'operation.cost.void',
   'operation.order.batch_void'
 ) AND dangerous = 0;
