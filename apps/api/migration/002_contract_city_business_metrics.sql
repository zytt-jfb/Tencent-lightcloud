-- ============================================================
-- Migration: 002_contract_city_business_metrics
-- 说明：新增 contract_city_business_metrics 表，承载经营测算所需的 Admin 主数据字段
-- 日期：2026-06-18
-- ============================================================

CREATE TABLE contract_city_business_metrics (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  contract_city_allocation_id BIGINT NOT NULL,
  estimated_order_amount_2026 DECIMAL(18,2) NOT NULL DEFAULT 0,
  estimated_income_amount_2026 DECIMAL(18,2) NOT NULL DEFAULT 0,
  remark VARCHAR(500) NULL,
  source_city_name VARCHAR(100) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_business_metrics_allocation_id (contract_city_allocation_id),
  CONSTRAINT fk_business_metrics_allocation_id
    FOREIGN KEY (contract_city_allocation_id)
    REFERENCES contract_city_allocations (id)
);
