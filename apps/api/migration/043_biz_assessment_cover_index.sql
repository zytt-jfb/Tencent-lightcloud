-- ============================================================================
-- 043_biz_assessment_cover_index —— 后评估明细表覆盖索引（性能）
--
-- 背景：概览汇总与供应商明细把 1.8 万行整表读进 Node 再做聚合，单次 1.1~1.8s。
--       实测（生产隔离副本）：同一批聚合加本索引后 0.55s → 0.22s；
--       COUNT(*) 走 index-only scan 仅 13ms，说明主要成本是回表读行。
-- 说明：列序按「过滤 → 分组 → 度量」排列，让下列查询全部命中 index-only scan：
--       ① WHERE status IN (...) ② WHERE status AND eval_month <= ?
--       ③ GROUP BY eval_month / city_id+city_name / supplier_name
--       ④ SUM(score) / MIN / MAX / 分数段 CASE WHEN
-- 约束：只追加，不改历史数据
-- ============================================================================

SET NAMES utf8mb4;

ALTER TABLE biz_assessment_record
  ADD INDEX idx_biz_assessment_cover
    (status, eval_month, supplier_name, city_id, city_name, project_name, score);
