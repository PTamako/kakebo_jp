-- 0015: Index only outstanding SBI funding transfers by effective due date.
-- Additive and idempotent. It does not change ledger amounts, dates, or holdings.
-- Apply only after reviewing EXPLAIN QUERY PLAN and verifying a D1 recovery bookmark.
-- The partial index matches applyDueSbiTransfers() exactly.
CREATE INDEX IF NOT EXISTS idx_entries_sbi_due_unapplied
  ON entries(COALESCE(transfer_date,date))
  WHERE type='transfer' AND transfer_target='sbi' AND COALESCE(transfer_applied,0)=0;

-- Record this explicitly applied schema change; never infer that every
-- historical migration was applied solely from this version marker.
INSERT OR IGNORE INTO schema_migrations(version,description)
  VALUES('schema-0015-verified','SBI outstanding transfers partial expression index verified');
