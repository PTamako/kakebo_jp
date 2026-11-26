-- 0112: Reduce rows read for statistics and legacy prepaid projections.
-- Additive only: no existing record or financial calculation changes.
-- Apply explicitly after reviewing the local regression test and obtaining a
-- current D1 Time Travel bookmark. Never replay older migrations.
CREATE INDEX IF NOT EXISTS idx_entries_type_date
  ON entries(type,date);
CREATE INDEX IF NOT EXISTS idx_entries_type_payment_date
  ON entries(type,payment_source,date);
CREATE INDEX IF NOT EXISTS idx_entries_transfer_target_effective_date
  ON entries(transfer_target,COALESCE(transfer_date,date),date)
  WHERE type='transfer';
