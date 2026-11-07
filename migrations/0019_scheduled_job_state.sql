-- Lightweight cron heartbeat; does not modify any entries, recurring plans,
-- investment holdings, card balances, payment-source settings or history.
-- Apply to Preview first, then Production before deploying the new NAV Worker.
CREATE TABLE IF NOT EXISTS scheduled_job_state (
  job_key TEXT PRIMARY KEY CHECK(job_key IN ('recurring','sbi','nav')),
  scheduled_at TEXT NOT NULL,
  finished_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  status TEXT NOT NULL CHECK(status IN ('success','failed','skipped')),
  summary_json TEXT NOT NULL DEFAULT '{}'
);
INSERT OR IGNORE INTO schema_migrations(version,description)
  VALUES('schema-0019-verified','Scheduled jobs heartbeat (no financial record changes)');
