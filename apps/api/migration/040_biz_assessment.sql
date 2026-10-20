-- ============================================================================
-- 040_biz_assessment —— 工程管理 / 后评估业务
-- 内容：二级模块登记、导入批次表、后评估事实表（导入与线下填报共用）、权限点与角色默认授权
-- 约束：只追加，不修改历史迁移；全部语句可重复执行
-- 口径：唯一键 dedup_key 由服务层归一化后生成（MySQL 唯一索引对 NULL 不生效，故不用联合唯一索引）
-- ============================================================================

SET NAMES utf8mb4;

-- ----------------------------
-- 1. 二级模块：后评估管理（挂在工程管理 level1 下）
-- ----------------------------
INSERT INTO biz_modules (id, code, name, level, parent_id, sort_order, status)
SELECT '00000000-0000-4000-8000-000000000040', 'assessment', '后评估管理', 'level2', '00000000-0000-4000-8000-000000000010', 1, 'active'
WHERE NOT EXISTS (SELECT 1 FROM biz_modules WHERE code = 'assessment');

-- ----------------------------
-- 2. 导入批次（留痕 + 可回滚）
-- ----------------------------
CREATE TABLE IF NOT EXISTS biz_assessment_batch (
  id VARCHAR(36) PRIMARY KEY,
  filename VARCHAR(255) NOT NULL,
  file_size INT NULL,
  eval_month CHAR(7) NULL,
  total_rows INT NOT NULL DEFAULT 0,
  valid_rows INT NOT NULL DEFAULT 0,
  duplicate_rows INT NOT NULL DEFAULT 0,
  failed_rows INT NOT NULL DEFAULT 0,
  inserted_rows INT NOT NULL DEFAULT 0,
  updated_rows INT NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'parsed',
  error_json JSON NULL,
  uploaded_by VARCHAR(36) NOT NULL,
  uploaded_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_biz_assessment_batch_month (eval_month),
  KEY idx_biz_assessment_batch_status (status)
);

-- ----------------------------
-- 3. 后评估事实表
--    source=import：管理员 Excel 导入，contract_id 可空
--    source=offline：地市人员线下填报，contract_id 必填
--    status：import 行固定 active；offline 行走 draft/submitted/returned/voided
-- ----------------------------
CREATE TABLE IF NOT EXISTS biz_assessment_record (
  id VARCHAR(36) PRIMARY KEY,
  source VARCHAR(16) NOT NULL DEFAULT 'import',
  batch_id VARCHAR(36) NULL,
  eval_month CHAR(7) NOT NULL,
  project_name VARCHAR(300) NOT NULL DEFAULT '',
  city_id VARCHAR(36) NULL,
  city_name VARCHAR(160) NOT NULL DEFAULT '',
  province_id VARCHAR(36) NULL,
  supplier_name VARCHAR(200) NOT NULL,
  contract_id VARCHAR(36) NULL,
  contract_no VARCHAR(100) NULL,
  score DECIMAL(6,2) NOT NULL,
  grade VARCHAR(4) NULL,
  eval_method VARCHAR(8) NOT NULL DEFAULT 'online',
  src_seq INT NULL,
  raw_json JSON NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  dedup_key VARCHAR(255) NOT NULL,
  submitted_by VARCHAR(36) NULL,
  submitted_at DATETIME NULL,
  returned_by VARCHAR(36) NULL,
  returned_at DATETIME NULL,
  return_reason VARCHAR(500) NULL,
  voided_by VARCHAR(36) NULL,
  voided_at DATETIME NULL,
  void_reason VARCHAR(255) NULL,
  created_by VARCHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_by VARCHAR(36) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_biz_assessment_dedup (dedup_key),
  KEY idx_biz_assessment_month (eval_month),
  KEY idx_biz_assessment_city_month (city_id, eval_month),
  KEY idx_biz_assessment_supplier (supplier_name),
  KEY idx_biz_assessment_batch (batch_id),
  KEY idx_biz_assessment_status (status),
  KEY idx_biz_assessment_contract (contract_id),
  KEY idx_biz_assessment_source (source)
);

-- ----------------------------
-- 4. 权限点（模块归属：工程管理 = ...010）
-- ----------------------------
INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000601', 'assessment.overview.read', '后评估概览查看', '00000000-0000-4000-8000-000000000010', 'read'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'assessment.overview.read');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000602', 'assessment.overview.export', '后评估概览导出', '00000000-0000-4000-8000-000000000010', 'export'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'assessment.overview.export');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000603', 'assessment.import.read', '后评估导入批次查看', '00000000-0000-4000-8000-000000000010', 'read'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'assessment.import.read');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000604', 'assessment.import.upload', '后评估数据导入', '00000000-0000-4000-8000-000000000010', 'upload'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'assessment.import.upload');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000605', 'assessment.import.delete', '后评估导入批次删除', '00000000-0000-4000-8000-000000000010', 'delete'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'assessment.import.delete');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000606', 'assessment.entry.read', '线下填报查看', '00000000-0000-4000-8000-000000000010', 'read'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'assessment.entry.read');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000607', 'assessment.entry.create', '线下填报编辑', '00000000-0000-4000-8000-000000000010', 'create'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'assessment.entry.create');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000608', 'assessment.entry.submit', '线下填报提交', '00000000-0000-4000-8000-000000000010', 'submit'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'assessment.entry.submit');

INSERT INTO biz_permissions (id, code, name, module_id, action)
SELECT '00000000-0000-4000-8000-000000000609', 'assessment.entry.return', '线下填报退回', '00000000-0000-4000-8000-000000000010', 'return'
WHERE NOT EXISTS (SELECT 1 FROM biz_permissions WHERE code = 'assessment.entry.return');

-- ----------------------------
-- 5. 角色默认授权
--    admin（省级运营管理员）：全部 9 项
--    city_user（地市用户）：概览查看/导出 + 填报查看/编辑/提交 + 工程管理入口
--    contract_manager：不授予
-- ----------------------------
INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000620', '00000000-0000-4000-8000-000000000002', 'assessment.overview.read'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'assessment.overview.read');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000621', '00000000-0000-4000-8000-000000000002', 'assessment.overview.export'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'assessment.overview.export');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000622', '00000000-0000-4000-8000-000000000002', 'assessment.import.read'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'assessment.import.read');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000623', '00000000-0000-4000-8000-000000000002', 'assessment.import.upload'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'assessment.import.upload');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000624', '00000000-0000-4000-8000-000000000002', 'assessment.import.delete'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'assessment.import.delete');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000625', '00000000-0000-4000-8000-000000000002', 'assessment.entry.read'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'assessment.entry.read');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000626', '00000000-0000-4000-8000-000000000002', 'assessment.entry.create'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'assessment.entry.create');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000627', '00000000-0000-4000-8000-000000000002', 'assessment.entry.submit'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'assessment.entry.submit');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000628', '00000000-0000-4000-8000-000000000002', 'assessment.entry.return'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000002' AND permission_code = 'assessment.entry.return');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000640', '00000000-0000-4000-8000-000000000004', 'assessment.overview.read'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000004' AND permission_code = 'assessment.overview.read');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000641', '00000000-0000-4000-8000-000000000004', 'assessment.overview.export'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000004' AND permission_code = 'assessment.overview.export');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000642', '00000000-0000-4000-8000-000000000004', 'assessment.entry.read'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000004' AND permission_code = 'assessment.entry.read');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000643', '00000000-0000-4000-8000-000000000004', 'assessment.entry.create'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000004' AND permission_code = 'assessment.entry.create');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000644', '00000000-0000-4000-8000-000000000004', 'assessment.entry.submit'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000004' AND permission_code = 'assessment.entry.submit');

INSERT INTO biz_role_permissions (id, role_id, permission_code)
SELECT '00000000-0000-4000-8000-000000000645', '00000000-0000-4000-8000-000000000004', 'portal.engineering.enter'
WHERE NOT EXISTS (SELECT 1 FROM biz_role_permissions WHERE role_id = '00000000-0000-4000-8000-000000000004' AND permission_code = 'portal.engineering.enter');
