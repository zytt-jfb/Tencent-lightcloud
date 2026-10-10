CREATE TABLE maintenance_vehicles (
  id VARCHAR(36) NOT NULL PRIMARY KEY, vehicle_code VARCHAR(100) NULL, plate_number VARCHAR(64) NOT NULL,
  vehicle_type VARCHAR(100) NULL, `usage` VARCHAR(160) NULL, driver_mobile VARCHAR(32) NULL, brand_model VARCHAR(255) NULL,
  fuel_type VARCHAR(64) NULL, ownership VARCHAR(64) NULL, org_province VARCHAR(160) NOT NULL, org_company VARCHAR(200) NOT NULL,
  org_region VARCHAR(160) NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'active', deleted_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_maintenance_vehicle_plate_org (plate_number, org_company, org_region),
  KEY idx_maintenance_vehicle_org_status (org_province, org_company, org_region, status, deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE maintenance_generators (
  id VARCHAR(36) NOT NULL PRIMARY KEY, generator_code VARCHAR(100) NOT NULL, contact_name VARCHAR(100) NULL, contact_mobile VARCHAR(32) NULL,
  model VARCHAR(255) NULL, rated_power_kw DECIMAL(12,3) NULL, standard_fuel_consumption DECIMAL(12,3) NULL, generator_type VARCHAR(100) NULL,
  fuel_type VARCHAR(64) NULL, ownership VARCHAR(64) NULL, usage_status VARCHAR(64) NULL, external_id VARCHAR(100) NULL,
  org_province VARCHAR(160) NOT NULL, org_company VARCHAR(200) NOT NULL, org_region VARCHAR(160) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active', deleted_at DATETIME NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_maintenance_generator_code_org (generator_code, org_company, org_region),
  KEY idx_maintenance_generator_org_status (org_province, org_company, org_region, status, deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
