-- 020：合同软删除字段 + 操作日志扩展字段
-- 说明：合同支持"真正删除"（软删除，保留删除记录与恢复入口），与业务作废(void)状态机解耦；
-- 操作日志补充 修改前/后摘要、批次号、失败原因，满足审计要求。
-- 注：跨方言幂等加列由 migrate.mjs 的 020 特殊分支处理（按列存在性判断），本文件为 MySQL 参照实现。

SET NAMES utf8mb4;

ALTER TABLE biz_contracts ADD COLUMN deleted_at DATETIME NULL;
ALTER TABLE biz_contracts ADD COLUMN deleted_by VARCHAR(36) NULL;
ALTER TABLE biz_contracts ADD COLUMN deleted_batch_id VARCHAR(36) NULL;
CREATE INDEX idx_biz_contracts_deleted ON biz_contracts (deleted_at);

ALTER TABLE biz_operation_logs ADD COLUMN summary_before TEXT NULL;
ALTER TABLE biz_operation_logs ADD COLUMN summary_after TEXT NULL;
ALTER TABLE biz_operation_logs ADD COLUMN batch_id VARCHAR(36) NULL;
ALTER TABLE biz_operation_logs ADD COLUMN error_message TEXT NULL;
CREATE INDEX idx_biz_op_log_batch ON biz_operation_logs (batch_id);
