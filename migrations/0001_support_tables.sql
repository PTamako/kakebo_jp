-- Forward-only, non-destructive preparation for databases already using the
-- live compatibility layer. Run on a CLONE first; do not apply automatically.
-- Do not drop, reset, or reclassify entries/rules/investment_snapshots.
CREATE TABLE IF NOT EXISTS category_icons (
  category TEXT PRIMARY KEY,
  icon TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS custom_rules (
  keyword TEXT PRIMARY KEY,
  category TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS dismissed_transfer_reminders (
  entry_id INTEGER PRIMARY KEY,
  dismissed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS ai_ocr_daily_usage (
  day TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS device_sessions (
  token_hash TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (
  ip_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
