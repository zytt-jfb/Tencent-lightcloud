-- ============================================================================
-- 044_biz_assessment_cover_index_v2 —— 覆盖索引补 eval_method
--
-- 问题：043 建的索引不含 eval_method，而概览汇总的窄列扫描需要它（分数分布卡片要显示
--       线上/线下条数）。列不在索引内 → 优化器放弃 index-only scan，退化成全表扫描，
--       生产实测 EXPLAIN: type=ALL, key=NULL，18k 行扫描约 300ms。
-- 修复：把 eval_method 并入索引（列序放在 score 之前，score 仍作为最后的度量列），
--       使汇总扫描恢复 index-only。
-- 说明：importedCount / entryCount 两个字段无任何页面使用，已从汇总响应中移除，
--       因此 source 列不进索引（少 64 字节，降低索引超长风险）。
-- 约束：只改索引，不动数据
-- ============================================================================

SET NAMES utf8mb4;

ALTER TABLE biz_assessment_record
  DROP INDEX idx_biz_assessment_cover,
  ADD INDEX idx_biz_assessment_cover
    (status, eval_month, supplier_name, city_id, city_name, project_name, eval_method, score);
