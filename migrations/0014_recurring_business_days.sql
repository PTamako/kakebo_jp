-- 0014: Japanese business-day recurring expenses.
-- SAFE: additive column only; preserves every existing plan, entry, and exclusion.
-- Run once in the production D1 Console BEFORE deploying the workday feature.
-- A workday plan is stored with schedule_type='weekly' and workday_only=1,
-- avoiding a risky rebuild of the existing CHECK(schedule_type IN ('monthly','weekly')).
ALTER TABLE recurring_plans
  ADD COLUMN workday_only INTEGER NOT NULL DEFAULT 0
  CHECK(workday_only IN (0,1));
