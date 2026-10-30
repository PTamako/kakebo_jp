-- Apply ONCE to existing D1. No new tables, no data backfill, no changes to existing rows.
-- Cloudflare D1 requires explicit production migration; do not apply schema.sql or old migrations.
ALTER TABLE payment_sources ADD COLUMN source_type TEXT NOT NULL DEFAULT 'standard'
  CHECK(source_type IN ('standard','prepaid'));
ALTER TABLE payment_sources ADD COLUMN opening_balance INTEGER NOT NULL DEFAULT 0
  CHECK(opening_balance >= 0);
ALTER TABLE payment_sources ADD COLUMN opening_date TEXT NOT NULL DEFAULT '';
ALTER TABLE payment_sources ADD COLUMN opening_entry_id INTEGER NOT NULL DEFAULT 0
  CHECK(opening_entry_id >= 0);
