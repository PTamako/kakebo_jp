-- Run only after 0010. Safe if the app-state table already exists.
-- This migration never inserts or changes any existing financial or review data.
-- Theme colors stay in per-device localStorage and are never synced to D1.
CREATE TABLE IF NOT EXISTS app_client_state (
  state_key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
