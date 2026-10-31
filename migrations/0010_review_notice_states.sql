-- Apply once to the existing production D1, after testing on a copy.
-- Only stores reviewed notification keys. No ledger, investment or client-setting changes.
CREATE TABLE IF NOT EXISTS review_notice_states (
  notice_key TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
