-- 0012: Unified recoverable trash for recurring plans and ledger entries.
-- MANUAL-ONLY. Never run automatically from Pages builds or API requests.
-- Apply after taking a verified production D1 backup, first test on a clone.
-- A recurring plan remains in recurring_plans with a trash marker.
-- Ledger entry removal stores a full JSON snapshot before deleting its row.
CREATE TABLE IF NOT EXISTS trash_items (
  item_type TEXT NOT NULL CHECK(item_type IN ('recurring_plan','entry')),
  item_id TEXT NOT NULL,
  payload_json TEXT,
  deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(item_type,item_id)
);
CREATE INDEX IF NOT EXISTS idx_trash_items_deleted_at ON trash_items(deleted_at DESC);

-- One-time, idempotent import of any legacy recurring-plan archive markers.
-- Historical recurring_plan_trash remains untouched for safe rollback.
-- An empty legacy table inserts 0 rows. This is NOT an app startup seed.
INSERT OR IGNORE INTO trash_items(item_type,item_id,payload_json,deleted_at)
SELECT 'recurring_plan',plan_id,NULL,archived_at FROM recurring_plan_trash;

-- IMPORTANT: Do not drop recurring_plan_trash in this migration.
-- Only remove it manually in a later version once this backfill and rollback
-- verification succeed; empty data alone does not warrant automatic DROP.
