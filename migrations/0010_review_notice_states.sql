-- Apply once to the existing production D1, after testing on a copy.
-- No INSERT, no updates/deletions of entries, recurring plans or investments.
-- No data backfill. Store theme, AI consent, receipt mode, and unsaved drafts.
CREATE TABLE IF NOT EXISTS app_client_state (
  state_key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS review_notice_states (
  notice_key TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
