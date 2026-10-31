-- Apply ONCE to existing production D1 before deploying the swipe-to-exclude API.
-- This is additive only: never delete, rewrite, or backfill historical entries.
CREATE TABLE IF NOT EXISTS recurring_candidate_exclusions (
  plan_id TEXT NOT NULL REFERENCES recurring_plans(id) ON DELETE CASCADE,
  month TEXT NOT NULL CHECK(length(month)=7 AND substr(month,5,1)='-'),
  excluded_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(plan_id, month)
);
