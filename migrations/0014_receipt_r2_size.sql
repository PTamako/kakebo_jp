-- Store receipt byte counts in D1 so the UI never needs to list R2 objects.
-- Existing rows retain NULL size until the receipt is explicitly uploaded/replaced.
-- Do not fetch R2 for backfill on login or page load.
ALTER TABLE receipt_r2_state ADD COLUMN size_bytes INTEGER DEFAULT NULL CHECK(size_bytes IS NULL OR (size_bytes >= 0 AND size_bytes <= 204800));
