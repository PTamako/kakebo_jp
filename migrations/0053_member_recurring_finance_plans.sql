-- 0053 DRAFT: member-owned, identity-bound financial recurring plans.
-- Existing legacy fixed expenses and SBI investment_plans are untouched.
-- Fixed plans link to an actual recurring_plans row with posting_mode=manual;
-- new member SBI plans use their own stable plan ID because the historical
-- investment_plans global fund_code/account_type PK is not multi-user-safe.
CREATE TABLE IF NOT EXISTS family_member_recurring_plans(
 plan_resource_id TEXT PRIMARY KEY CHECK(length(plan_resource_id)=32 AND plan_resource_id NOT GLOB '*[^0-9a-f]*'),
 household_id TEXT NOT NULL,
 owner_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 plan_type TEXT NOT NULL CHECK(plan_type IN('fixed_cost','sbi_tsumitate')),
 bank_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 bank_version INTEGER NOT NULL CHECK(bank_version>=1),
 securities_account_id TEXT REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 securities_version INTEGER,
 legacy_recurring_plan_id TEXT UNIQUE,
 fund_code TEXT,
 fund_name TEXT,
 account_type TEXT,
 amount_jpy INTEGER NOT NULL CHECK(amount_jpy BETWEEN 1 AND 10000000),
 due_day INTEGER NOT NULL CHECK(due_day BETWEEN 1 AND 28),
 start_month TEXT NOT NULL CHECK(start_month GLOB '20[0-9][0-9]-[01][0-9]'),
 end_month TEXT NOT NULL CHECK(end_month GLOB '20[0-9][0-9]-[01][0-9]'),
 category TEXT NOT NULL CHECK(length(category) BETWEEN 1 AND 100),
 merchant TEXT NOT NULL CHECK(length(merchant) BETWEEN 1 AND 120),
 plan_payload_sha256 TEXT NOT NULL CHECK(length(plan_payload_sha256)=64),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','revoked')),
 created_by_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id),
 created_at INTEGER NOT NULL CHECK(created_at>0),
 revoked_at INTEGER,
 CHECK(start_month<=end_month),
 CHECK((plan_type='fixed_cost' AND legacy_recurring_plan_id IS NOT NULL
  AND securities_account_id IS NULL AND securities_version IS NULL
  AND fund_code IS NULL AND fund_name IS NULL AND account_type IS NULL)
 OR (plan_type='sbi_tsumitate' AND legacy_recurring_plan_id IS NULL
  AND securities_account_id IS NOT NULL AND securities_version>=1
  AND length(fund_code)=8 AND fund_code NOT GLOB '*[^A-Z0-9]*'
  AND length(fund_name) BETWEEN 1 AND 120 AND account_type='tsumitate')),
 CHECK((status='active' AND revoked_at IS NULL)
    OR (status='revoked' AND revoked_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_member_recurring_plans
 ON family_member_recurring_plans(household_id,owner_user_id,status,plan_resource_id);
CREATE TRIGGER IF NOT EXISTS trg_member_recurring_plan_owner BEFORE INSERT ON family_member_recurring_plans
WHEN NEW.status<>'active'
 OR NOT EXISTS(
 SELECT 1 FROM homeflow_identity_links u
 JOIN family_financial_accounts bank ON bank.account_id=NEW.bank_account_id
 WHERE u.user_id=NEW.owner_user_id AND u.household_id=NEW.household_id
 AND u.state='active' AND u.role='member' AND NEW.created_by_user_id=u.user_id
 AND bank.household_id=NEW.household_id AND bank.owner_user_id=NEW.owner_user_id
 AND bank.account_kind='bank' AND bank.origin='member_created'
 AND bank.is_archived=0 AND bank.version=NEW.bank_version
 )
 OR (NEW.plan_type='sbi_tsumitate' AND NOT EXISTS(
 SELECT 1 FROM family_financial_accounts sec
 WHERE sec.account_id=NEW.securities_account_id AND sec.owner_user_id=NEW.owner_user_id
 AND sec.household_id=NEW.household_id AND sec.account_kind='securities'
 AND sec.origin='member_created' AND sec.is_archived=0
 AND sec.version=NEW.securities_version AND sec.account_id<>NEW.bank_account_id
 ))
 OR (NEW.plan_type='fixed_cost' AND NOT EXISTS(
 SELECT 1 FROM recurring_plans p WHERE p.id=NEW.legacy_recurring_plan_id
 AND p.name=NEW.merchant AND p.category=NEW.category
 AND p.amount=NEW.amount_jpy AND p.day=NEW.due_day AND p.start_month=NEW.start_month
 AND p.payment_source='bank:'||NEW.bank_account_id
 AND p.enabled=1 AND p.posting_mode='manual' AND p.schedule_type='monthly'
 AND p.workday_only=0 AND p.interval_months=1
 ))
BEGIN SELECT RAISE(ABORT,'MEMBER_RECURRING_PLAN_OWNER_OR_SOURCE_CHANGED'); END;
CREATE TRIGGER IF NOT EXISTS trg_member_recurring_plan_immutable BEFORE UPDATE OF
 plan_resource_id,household_id,owner_user_id,plan_type,bank_account_id,bank_version,
 securities_account_id,securities_version,legacy_recurring_plan_id,
 fund_code,fund_name,account_type,amount_jpy,due_day,start_month,end_month,
 category,merchant,plan_payload_sha256,created_by_user_id,created_at
ON family_member_recurring_plans
BEGIN SELECT RAISE(ABORT,'MEMBER_RECURRING_PLAN_FROZEN'); END;
CREATE TRIGGER IF NOT EXISTS trg_member_recurring_plan_revoke BEFORE UPDATE ON family_member_recurring_plans
WHEN NOT(OLD.status='active' AND NEW.status='revoked' AND NEW.revoked_at>OLD.created_at)
BEGIN SELECT RAISE(ABORT,'MEMBER_RECURRING_PLAN_CANNOT_REAUTHORIZE'); END;
CREATE TRIGGER IF NOT EXISTS trg_member_recurring_plan_delete BEFORE DELETE ON family_member_recurring_plans
BEGIN SELECT RAISE(ABORT,'MEMBER_RECURRING_PLAN_IMMUTABLE'); END;
-- Prevent legacy plan UI or auto engine from repurposing a member-bound plan.
-- The member must create a new version with a new HomeFlow authorization.
CREATE TRIGGER IF NOT EXISTS trg_member_recurring_legacy_plan_update BEFORE UPDATE ON recurring_plans
WHEN EXISTS(SELECT 1 FROM family_member_recurring_plans p WHERE p.legacy_recurring_plan_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'MEMBER_RECURRING_LEGACY_TERMS_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_member_recurring_legacy_plan_delete BEFORE DELETE ON recurring_plans
WHEN EXISTS(SELECT 1 FROM family_member_recurring_plans p WHERE p.legacy_recurring_plan_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'MEMBER_RECURRING_LEGACY_TERMS_IMMUTABLE'); END;
-- The old recurring generator cannot double post the protected member plan.
CREATE TRIGGER IF NOT EXISTS trg_member_recurring_block_old_scheduled_entry BEFORE INSERT ON entries
WHEN NEW.client_request_id LIKE 'recurring_%'
 AND EXISTS(SELECT 1 FROM family_member_recurring_plans p
  WHERE p.legacy_recurring_plan_id IS NOT NULL
  AND NEW.client_request_id LIKE 'recurring_'||replace(p.legacy_recurring_plan_id,'-','')||'_%')
BEGIN SELECT RAISE(ABORT,'MEMBER_RECURRING_REQUIRES_APPROVAL_PROOF'); END;
INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(
 'schema-0053-member-recurring-finance-plans',
 'UNDEPLOYED owner-scoped fixed fee and SBI tsumitate plan immutable source link');
