-- 0020: multi-weekday, multi-date and interval/annual recurring plans.
-- Additive only. Old monthly plans keep their single-day YYYYMM identities.
-- Apply to both production and Preview D1 before deploying updated Pages/Worker.
-- This migration changes no existing recurring plan or recorded expense rows.
ALTER TABLE recurring_plans ADD COLUMN weekdays_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(weekdays_json));
ALTER TABLE recurring_plans ADD COLUMN month_days_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(month_days_json));
ALTER TABLE recurring_plans ADD COLUMN interval_months INTEGER NOT NULL DEFAULT 1 CHECK(interval_months BETWEEN 1 AND 24);
