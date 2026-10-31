-- Apply once to the existing production D1, after testing on a copy.
-- No INSERT, no updates/deletions of entries, recurring plans or investments.
-- No data backfill. Store AI consent, currency and receipt preferences, and unsaved drafts. Theme remains device-local.
CREATE TABLE IF NOT EXISTS app_client_state (
  state_key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS review_notice_states (
  notice_key TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
