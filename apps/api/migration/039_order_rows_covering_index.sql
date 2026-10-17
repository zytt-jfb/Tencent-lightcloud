-- 039: 订单表覆盖索引，修复经营单位详情页（地市详情）加载缓慢
-- 背景：biz_order_rows 已达数十万行（生产约 63 万行），详情页的 4 类查询均按
--       (city_id + 有效状态) 过滤：
--         1) 年度选项  DISTINCT SUBSTRING(business_month,1,4)
--         2) 金额聚合  SUM(completion_amount_fen) / SUM(gross_profit_fen)
--         3) 合同分组  GROUP BY contract_id
--         4) 明细列表  ORDER BY business_month DESC, created_at DESC LIMIT N
--       原有索引 idx_biz_order_row_city_month(city_id, business_month) 只能用到
--       city_id 前缀，剩余状态条件与金额列都要回表读取宽行（平均约 2.3KB），
--       导致单次查询耗时数十秒；idx_order_current(is_current,validation_status,is_void)
--       因 is_current 基数仅为 1 而完全失去选择性。
-- 方案：新增一条覆盖索引，使上述查询全部走 "Using index"，不再回表；
--       明细查询借助索引顺序完成倒序扫描（Backward index scan），消除 filesort。
-- 说明：validation_status/is_current/is_void/city_id 在业务查询中恒为等值条件，
--       因此按该顺序前置可同时满足「带 city_id」与「不带 city_id（全局年度）」两类查询。
CREATE INDEX idx_order_scope_cover ON biz_order_rows
  (validation_status, is_current, is_void, city_id, business_month, created_at,
   contract_id, completion_amount_fen, gross_profit_fen);
