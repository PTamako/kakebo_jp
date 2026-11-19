-- 0109: Variable monthly/bimonthly household bills remain drafts until explicitly confirmed.
-- No zero-yen placeholder in recurring_plans, no auto posting, no historical rewrite.
CREATE TABLE IF NOT EXISTS variable_recurring_plans (
 id TEXT PRIMARY KEY CHECK(length(id)=36),
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 category TEXT NOT NULL CHECK(length(category) BETWEEN 1 AND 100),
 payment_source TEXT NOT NULL CHECK(length(payment_source) BETWEEN 1 AND 160),
 start_month TEXT NOT NULL CHECK(start_month GLOB '20[0-9][0-9]-[01][0-9]'),
 interval_months INTEGER NOT NULL CHECK(interval_months IN (1,2,3,6,12)),
 budget_jpy INTEGER CHECK(budget_jpy IS NULL OR budget_jpy BETWEEN 1 AND 10000000),
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS variable_recurring_bills (
 plan_id TEXT NOT NULL REFERENCES variable_recurring_plans(id) ON DELETE RESTRICT,
 period_month TEXT NOT NULL CHECK(period_month GLOB '20[0-9][0-9]-[01][0-9]'),
 amount_jpy INTEGER CHECK(amount_jpy IS NULL OR amount_jpy BETWEEN 1 AND 10000000),
 bill_date TEXT,
 expense_date TEXT,
 paid_date TEXT,
 service_start TEXT,
 service_end TEXT,
 source_type TEXT NOT NULL DEFAULT 'manual' CHECK(source_type IN ('manual','document')),
 source_document_id TEXT,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','posted')),
 posted_entry_id INTEGER REFERENCES entries(id) ON DELETE RESTRICT,
 updated_at INTEGER NOT NULL,
 PRIMARY KEY(plan_id,period_month),
 CHECK((status='draft' AND posted_entry_id IS NULL) OR
       (status='posted' AND posted_entry_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_variable_recurring_plan_cycle
 ON variable_recurring_plans(enabled,start_month,interval_months);
CREATE INDEX IF NOT EXISTS idx_variable_recurring_bill_posted
 ON variable_recurring_bills(posted_entry_id) WHERE posted_entry_id IS NOT NULL;
INSERT OR IGNORE INTO schema_migrations(version,description)
 VALUES('schema-0109-variable-recurring-bills',
 'Variable bills and their periods separated from legacy fixed-amount auto-posting');