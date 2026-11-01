-- 0013: Remember how each fixed-expense plan is posted. MANUAL-ONLY migration.
-- Back up the production D1 first. Apply this file ONCE before deploying
-- the new Pages code or the separate recurring scheduler Worker.
-- Existing schedules remain manual; no entries are created/changed here.
ALTER TABLE recurring_plans ADD COLUMN posting_mode TEXT NOT NULL DEFAULT 'manual'
  CHECK(posting_mode IN ('manual','auto'));
ALTER TABLE recurring_plans ADD COLUMN auto_from_month TEXT NOT NULL DEFAULT ''
  CHECK(auto_from_month = '' OR (length(auto_from_month)=7 AND substr(auto_from_month,5,1)='-'));
