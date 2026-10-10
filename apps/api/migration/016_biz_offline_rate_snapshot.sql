-- ============================================================================
-- 维护管理经营数据中台（新基线）— M8 修复 016：线下完工费率快照与毛利
-- 版本：016_biz_offline_rate_snapshot
-- 说明：毛利润 = (订单金额 + 线下完工金额) × 管理费率（指标字典 MET-003）；
--       线下完工在提交（pending）时按 合同+地市+业务月份 快照管理费率并计算毛利。
--       旧迁移不可变；本迁移仅追加。
-- ============================================================================

SET NAMES utf8mb4;

-- 管理费率快照（基点，如 12.35% => 1235；提交时固化，与合同费率历史解耦）
ALTER TABLE biz_offline_completions
  ADD COLUMN fee_rate_snapshot_bp INT NULL COMMENT '管理费率快照（基点，提交时按合同+地市+业务月份固化）';

-- 完工毛利（分）= amount_fen × fee_rate_snapshot_bp / 10000（提交时计算，审核通过后计入）
ALTER TABLE biz_offline_completions
  ADD COLUMN gross_profit_fen BIGINT NOT NULL DEFAULT 0 COMMENT '完工毛利（分）';
