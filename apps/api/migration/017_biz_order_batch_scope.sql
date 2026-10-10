-- ============================================================================
-- 维护管理经营数据中台（新基线）— M8 修复 017：订单批次上传范围快照
-- 版本：017_biz_order_batch_scope
-- 说明：批次创建时固化上传人数据范围（super=all / admin=province/city / contract 拒绝）；
--       行级校验在 processBatch 解析时按该快照执行（每行省份/地市必须在上传人范围内）。
-- ============================================================================

SET NAMES utf8mb4;

ALTER TABLE biz_order_import_batches
  ADD COLUMN data_scope_json VARCHAR(500) NULL COMMENT '上传时数据范围快照（JSON：{roleCode,scopeType,provinceIds,cityId}）';
