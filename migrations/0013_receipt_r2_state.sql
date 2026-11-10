-- R2 receipt deletion tombstones prevent old iPhones from resurrecting deleted photos.
-- Additive table only: no historical financial or receipt rows are modified.
CREATE TABLE IF NOT EXISTS receipt_r2_state (
  entry_id INTEGER PRIMARY KEY,
  deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_receipt_r2_deleted ON receipt_r2_state(deleted);
