-- Additive archive for registered recurring plans. Apply ONCE to existing D1
-- before using the new reversible plan deletion workflow.
-- No changes to entries, recurring_plans, investment data, or historical bills.
CREATE TABLE IF NOT EXISTS recurring_plan_trash (
  plan_id TEXT PRIMARY KEY REFERENCES recurring_plans(id) ON DELETE CASCADE,
  archived_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
