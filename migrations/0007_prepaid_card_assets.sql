-- Explicit one-time, additive migration. DO NOT apply schema.sql to production.
-- Existing Suica/PASMO transactions and original card settings remain unchanged.
CREATE TABLE IF NOT EXISTS prepaid_cards (
  name TEXT PRIMARY KEY REFERENCES payment_sources(name),
  opening_balance INTEGER NOT NULL DEFAULT 0 CHECK(opening_balance>=0),
  opening_entry_id INTEGER NOT NULL DEFAULT 0 CHECK(opening_entry_id>=0),
  opening_date TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_entries_prepaid_target ON entries(type,transfer_target,date,id);
CREATE INDEX IF NOT EXISTS idx_entries_prepaid_spend ON entries(type,payment_source,date,id);
