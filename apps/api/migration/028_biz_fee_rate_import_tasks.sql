-- 管理费率批量维护导入任务与行明细。
-- 应用启动不自动执行；由迁移流程在发布前执行。

CREATE TABLE IF NOT EXISTS `biz_fee_rate_import_tasks` (
  `id` varchar(36) NOT NULL,
  `operator_user_id` varchar(36) NOT NULL,
  `file_name` varchar(255) NOT NULL,
  `file_hash` varchar(64) NOT NULL,
  `status` varchar(24) NOT NULL DEFAULT 'queued',
  `total_rows` int NOT NULL DEFAULT 0,
  `new_count` int NOT NULL DEFAULT 0,
  `overwrite_count` int NOT NULL DEFAULT 0,
  `error_count` int NOT NULL DEFAULT 0,
  `skip_count` int NOT NULL DEFAULT 0,
  `affected_order_count` int NOT NULL DEFAULT 0,
  `affected_amount_fen` bigint NOT NULL DEFAULT 0,
  `recalculated` tinyint(1) NOT NULL DEFAULT 0,
  `error_summary` varchar(1000) DEFAULT NULL,
  `payload_json` json DEFAULT NULL,
  `result_json` json DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `confirmed_at` datetime DEFAULT NULL,
  `finished_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_biz_fee_rate_task_operator` (`operator_user_id`),
  KEY `idx_biz_fee_rate_task_created` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `biz_fee_rate_import_task_rows` (
  `id` varchar(36) NOT NULL,
  `task_id` varchar(36) NOT NULL,
  `row_no` int NOT NULL,
  `contract_id` varchar(36) DEFAULT NULL,
  `city_id` varchar(36) DEFAULT NULL,
  `effective_month` varchar(7) DEFAULT NULL,
  `rate_bp` int DEFAULT NULL,
  `prev_rate_bp` int DEFAULT NULL,
  `change_reason` varchar(255) DEFAULT NULL,
  `outcome` varchar(16) NOT NULL DEFAULT 'error',
  `message` text,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_biz_fee_rate_row_task` (`task_id`),
  KEY `idx_biz_fee_rate_row_combo` (`contract_id`, `city_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
