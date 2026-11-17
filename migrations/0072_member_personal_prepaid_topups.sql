-- Personal prepaid credits are owner-scoped immutable asset movements, never income/expense.
CREATE TABLE IF NOT EXISTS family_member_prepaid_topups (
 request_id TEXT PRIMARY KEY CHECK(length(request_id)=32),
 household_id TEXT NOT NULL,
 owner_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 prepaid_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 prepaid_version INTEGER NOT NULL CHECK(prepaid_version>=1),
 idempotency_hash TEXT NOT NULL UNIQUE CHECK(length(idempotency_hash)=64),
 amount_jpy INTEGER NOT NULL CHECK(amount_jpy BETWEEN 1 AND 10000000),
 effective_date TEXT NOT NULL CHECK(length(effective_date)=10),
 created_at INTEGER NOT NULL CHECK(created_at>0)
);
CREATE INDEX IF NOT EXISTS idx_member_topups_account
 ON family_member_prepaid_topups(household_id,prepaid_account_id,created_at DESC);
CREATE TRIGGER IF NOT EXISTS trg_member_topup_scope BEFORE INSERT ON family_member_prepaid_topups
 WHEN NOT EXISTS (
  SELECT 1 FROM homeflow_identity_links actor
  JOIN family_financial_accounts a ON a.account_id=NEW.prepaid_account_id
  WHERE actor.user_id=NEW.owner_user_id AND actor.household_id=NEW.household_id
   AND actor.role='member' AND actor.state='active'
   AND a.household_id=NEW.household_id AND a.owner_user_id=NEW.owner_user_id
   AND a.account_kind='prepaid' AND a.origin='member_created'
   AND a.is_archived=0 AND a.version=NEW.prepaid_version
 ) BEGIN SELECT RAISE(ABORT,'PERSONAL_PREPAID_TOPUP_OWNER_INVALID'); END;
CREATE TRIGGER IF NOT EXISTS trg_member_topup_no_update BEFORE UPDATE ON family_member_prepaid_topups
 BEGIN SELECT RAISE(ABORT,'PERSONAL_PREPAID_TOPUP_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_member_topup_no_delete BEFORE DELETE ON family_member_prepaid_topups
 BEGIN SELECT RAISE(ABORT,'PERSONAL_PREPAID_TOPUP_IMMUTABLE'); END;
-- The original prepaid spend executor must include member top-ups in its atomic balance.
DROP TRIGGER IF EXISTS trg_family_prepaid_balance_atomic;
CREATE TRIGGER trg_family_prepaid_balance_atomic
 BEFORE INSERT ON family_prepaid_balance_journal
 WHEN NOT EXISTS (
  SELECT 1 FROM family_prepaid_actions_applied a
  WHERE a.homeflow_request_id=NEW.homeflow_request_id
   AND a.household_id=NEW.household_id AND a.prepaid_account_id=NEW.prepaid_account_id
   AND a.date=NEW.effective_date AND a.balance_after_jpy=NEW.balance_after_jpy
   AND NEW.delta_jpy=CASE WHEN a.action='topup' THEN a.amount_jpy ELSE -a.amount_jpy END
   AND NEW.balance_after_jpy=
      COALESCE((SELECT SUM(j.delta_jpy) FROM family_prepaid_balance_journal j WHERE j.prepaid_account_id=NEW.prepaid_account_id),0)
     +COALESCE((SELECT SUM(t.amount_jpy) FROM family_member_prepaid_topups t WHERE t.prepaid_account_id=NEW.prepaid_account_id),0)
     +COALESCE((SELECT SUM(c.amount_jpy) FROM family_points_prepaid_credits c WHERE c.prepaid_account_id=NEW.prepaid_account_id),0)
     -COALESCE((SELECT SUM(r.debited_prepaid_jpy) FROM family_points_prepaid_refunds r WHERE r.prepaid_account_id=NEW.prepaid_account_id),0)
     +NEW.delta_jpy AND NEW.balance_after_jpy>=0
 ) BEGIN SELECT RAISE(ABORT,'PREPAID_OVERDRAFT_OR_CONCURRENT_BALANCE'); END;
INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(
 'schema-0072-member-personal-prepaid-topups',
 'Immutable personally confirmed prepaid topups without bank accounts or family owner approvals');
