-- 0071: bankless personal SBI recurring plan; a schedule, NOT a debit or fund buy.
CREATE TABLE IF NOT EXISTS family_member_sbi_plans (
 plan_resource_id TEXT PRIMARY KEY CHECK(length(plan_resource_id)=32),
 household_id TEXT NOT NULL,
 owner_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 securities_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 securities_version INTEGER NOT NULL CHECK(securities_version>=1),
 amount_jpy INTEGER NOT NULL CHECK(amount_jpy BETWEEN 1 AND 10000000),
 due_day INTEGER NOT NULL CHECK(due_day BETWEEN 1 AND 28),
 start_month TEXT NOT NULL,
 end_month TEXT NOT NULL,
 fund_code TEXT NOT NULL CHECK(length(fund_code)=8),
 fund_name TEXT NOT NULL CHECK(length(fund_name) BETWEEN 1 AND 120),
 account_type TEXT NOT NULL DEFAULT 'tsumitate' CHECK(account_type='tsumitate'),
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN('active','revoked')),
 created_at INTEGER NOT NULL CHECK(created_at>0),
 revoked_at INTEGER,
 CHECK(start_month<=end_month),
 CHECK((status='active' AND revoked_at IS NULL) OR (status='revoked' AND revoked_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_member_bankless_sbi_owner ON family_member_sbi_plans(household_id,owner_user_id,created_at DESC);
CREATE TRIGGER IF NOT EXISTS trg_member_bankless_sbi_owner BEFORE INSERT ON family_member_sbi_plans
 WHEN NOT EXISTS (
  SELECT 1 FROM homeflow_identity_links member
  JOIN family_financial_accounts sec ON sec.account_id=NEW.securities_account_id
  WHERE member.user_id=NEW.owner_user_id AND member.household_id=NEW.household_id
   AND member.role='member' AND member.state='active'
   AND sec.owner_user_id=NEW.owner_user_id AND sec.household_id=NEW.household_id
   AND sec.account_kind='securities' AND sec.origin='member_created'
   AND sec.is_archived=0 AND sec.version=NEW.securities_version
 ) BEGIN SELECT RAISE(ABORT,'PERSONAL_SBI_ACCOUNT_SCOPE_INVALID'); END;
CREATE TRIGGER IF NOT EXISTS trg_member_bankless_sbi_immutable
 BEFORE UPDATE OF plan_resource_id,household_id,owner_user_id,securities_account_id,
 securities_version,amount_jpy,due_day,start_month,end_month,fund_code,fund_name,
 account_type,payload_sha256,created_at ON family_member_sbi_plans
 BEGIN SELECT RAISE(ABORT,'PERSONAL_SBI_PLAN_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_member_bankless_sbi_revoke
 BEFORE UPDATE ON family_member_sbi_plans WHEN NOT(
 OLD.status='active' AND NEW.status='revoked' AND NEW.revoked_at IS NOT NULL)
 BEGIN SELECT RAISE(ABORT,'PERSONAL_SBI_PLAN_ALREADY_REVOKED'); END;
CREATE TRIGGER IF NOT EXISTS trg_member_bankless_sbi_delete BEFORE DELETE ON family_member_sbi_plans
 BEGIN SELECT RAISE(ABORT,'PERSONAL_SBI_PLAN_NO_DELETE'); END;
INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(
 'schema-0071-member-bankless-sbi',
 'Owner-scoped personal SBI plan without bank accounts, owner review, or ledger writes');
