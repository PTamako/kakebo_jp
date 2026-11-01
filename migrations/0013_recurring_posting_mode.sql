-- 0013: Persistent posting mode and monthly/weekly frequency.
-- Apply manually once after backing up the production D1, BEFORE deploying Pages/Worker.
-- No historical data updates or auto-created entries. Old plans remain monthly/manual.
ALTER TABLE recurring_plans ADD COLUMN posting_mode TEXT NOT NULL DEFAULT 'manual'
  CHECK(posting_mode IN ('manual','auto'));
ALTER TABLE recurring_plans ADD COLUMN auto_from_month TEXT NOT NULL DEFAULT ''
  CHECK(auto_from_month='' OR (length(auto_from_month)=7 AND substr(auto_from_month,5,1)='-'));
ALTER TABLE recurring_plans ADD COLUMN schedule_type TEXT NOT NULL DEFAULT 'monthly'
  CHECK(schedule_type IN ('monthly','weekly'));
ALTER TABLE recurring_plans ADD COLUMN weekday INTEGER NOT NULL DEFAULT 0
  CHECK(weekday BETWEEN 0 AND 6);

-- Weekly exclusions are per occurrence, unlike monthly excluded plan months.
CREATE TABLE IF NOT EXISTS recurring_date_exclusions (
  plan_id TEXT NOT NULL REFERENCES recurring_plans(id) ON DELETE CASCADE,
  date TEXT NOT NULL CHECK(length(date)=10 AND substr(date,5,1)='-' AND substr(date,8,1)='-'),
  excluded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(plan_id,date)
);
