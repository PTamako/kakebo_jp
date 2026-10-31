-- Apply once to the existing production D1, after testing on a copy.
-- No INSERT, no updates/deletions of entries, recurring plans or investments.
CREATE TABLE IF NOT EXISTS review_notice_states (
  notice_key TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
