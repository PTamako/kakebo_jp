-- Additive migration tracking only. No data is deleted, rebuilt or recategorized.
-- Test against an independently copied D1 before any production execution.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  description TEXT NOT NULL
);
INSERT OR IGNORE INTO schema_migrations(version, description)
VALUES('0002','Track database migrations without changing existing ledger, rules or investments');
