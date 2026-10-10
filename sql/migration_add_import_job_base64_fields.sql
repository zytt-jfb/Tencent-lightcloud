-- 经营单元上报系统 - import_jobs 表新增字段迁移
-- 执行前请备份数据库！
-- 执行时间：2026-06-25

USE `zy-data-d2g9g1ghr47ac6254`;

-- 1. 新增 source_file_base64 字段（存储上传文件的 Base64 内容，LONGTEXT 支持大文件）
ALTER TABLE `import_jobs`
  ADD COLUMN `source_file_base64` LONGTEXT NULL COMMENT '上传文件 Base64 内容'
  AFTER `source_file_url`;

-- 2. 新增 source_file_name 字段（存储原始文件名，用于解码时确定扩展名）
ALTER TABLE `import_jobs`
  ADD COLUMN `source_file_name` VARCHAR(255) NULL COMMENT '上传原始文件名'
  AFTER `source_file_base64`;

-- 验证字段已添加
SHOW COLUMNS FROM `import_jobs` LIKE 'source_file_%';

-- 迁移说明：
-- 1) source_file_base64: 持久化存储上传的 Excel 文件内容（Base64 编码）
--    这样容器重启后，preview/confirm 仍然可以读取文件内容
-- 2) source_file_name: 记录原始文件名（如"合同导入.xlsx"），
--    用于 Base64 解码时确定临时文件扩展名（.xlsx / .xls / .csv）
--
-- 旧数据处理：
-- 旧的 source_file_url 字段（如 /uploads/contract-1718000000000.xlsx）仍然保留，
-- 但新上传的文件将使用 Base64 持久化，不再依赖本地磁盘。
-- 如果旧 jobs 需要重新 preview/confirm，需要重新上传文件。
