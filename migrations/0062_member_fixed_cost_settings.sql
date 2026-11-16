-- 0062: member-owned fixed-cost settings without an artificial bank account.
-- This table records a private schedule definition only. It never directly
-- modifies the family ledger or triggers the legacy automatic posting engine.
CREATE TABLE IF NOT EXISTS family_member_fixed_cost_settings (
 plan_id TEXT PRIMARY KEY CHECK(length(plan_id)=32 AND plan_id NOT GLOB '*[^0-9a-f]*'),
 household_id TEXT NOT NULL,
 owner_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120),
 amount_jpy INTEGER NOT NULL CHECK(amount_jpy BETWEEN 1 AND 10000000),
 schedule_type TEXT NOT NULL CHECK(schedule_type IN ('monthly','weekly','workday')),
 interval_months INTEGER NOT NULL CHECK(interval_months IN (1,2,3,6,12)),
 month_days_json TEXT NOT NULL CHECK(json_valid(month_days_json) AND json_type(month_days_json)='array'),
 weekdays_json TEXT NOT NULL CHECK(json_valid(weekdays_json) AND json_type(weekdays_json)='array'),
 category TEXT NOT NULL CHECK(length(category) BETWEEN 1 AND 100),
 payment_source TEXT NOT NULL CHECK(length(payment_source) BETWEEN 1 AND 160),
 start_month TEXT NOT NULL CHECK(start_month GLOB '20[0-9][0-9]-[01][0-9]'),
 posting_mode TEXT NOT NULL CHECK(posting_mode='manual'),
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN(0,1)),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 created_at INTEGER NOT NULL CHECK(created_at>0),
 updated_at INTEGER NOT NULL CHECK(updated_at>=created_at)
);
CREATE INDEX IF NOT EXISTS idx_member_fixed_cost_owner
 ON family_member_fixed_cost_settings(household_id,owner_user_id,enabled,updated_at DESC);
CREATE TRIGGER IF NOT EXISTS trg_member_fixed_cost_owner_insert
 BEFORE INSERT ON family_member_fixed_cost_settings
 WHEN NOT EXISTS(SELECT 1 FROM homeflow_identity_links u WHERE u.user_id=NEW.owner_user_id
 AND u.household_id=NEW.household_id AND u.role='member' AND u.state='active')
 BEGIN SELECT RAISE(ABORT,'FIXED_COST_NOT_ACTIVE_MEMBER'); END;
CREATE TRIGGER IF NOT EXISTS trg_member_fixed_cost_immutable_scope
 BEFORE UPDATE OF plan_id,household_id,owner_user_id,created_at
 ON family_member_fixed_cost_settings
 BEGIN SELECT RAISE(ABORT,'FIXED_COST_OWNER_IMMUTABLE'); END;
INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(
 'schema-0062-member-fixed-cost-settings',
 'Personal recurring expense settings isolated per HomeFlow member; no bank required and no automatic posting'
);
