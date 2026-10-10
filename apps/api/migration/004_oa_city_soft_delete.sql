-- OA Web first release: reversible city deletion fields.
-- Apply this migration before enabling the admin city management endpoints.
ALTER TABLE cities
  ADD COLUMN is_deleted TINYINT NOT NULL DEFAULT 0 AFTER sort_order,
  ADD COLUMN deleted_at DATETIME NULL AFTER is_deleted;

CREATE INDEX idx_cities_deleted_sort ON cities (is_deleted, sort_order, id);
