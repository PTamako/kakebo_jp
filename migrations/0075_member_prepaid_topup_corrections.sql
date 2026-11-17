-- Append-only CAS corrections to personally attested prepaid top-ups.
-- Both account-side adjustments belong to the same immutable event; neither
-- a household income/expense nor an external issuer transaction is created.
CREATE TABLE IF NOT EXISTS family_member_prepaid_topup_corrections (
 correction_id TEXT PRIMARY KEY CHECK(length(correction_id)=32),
 topup_request_id TEXT NOT NULL REFERENCES family_member_prepaid_topups(request_id) ON DELETE RESTRICT,
 household_id TEXT NOT NULL,
 owner_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 10000),
 before_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 after_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 after_account_version INTEGER NOT NULL CHECK(after_account_version>=1),
 before_amount_jpy INTEGER NOT NULL CHECK(before_amount_jpy BETWEEN 1 AND 10000000),
 after_amount_jpy INTEGER NOT NULL CHECK(after_amount_jpy BETWEEN 1 AND 10000000),
 before_effective_date TEXT NOT NULL CHECK(length(before_effective_date)=10),
 after_effective_date TEXT NOT NULL CHECK(length(after_effective_date)=10),
 reason TEXT NOT NULL CHECK(length(reason) BETWEEN 2 AND 200),
 idempotency_hash TEXT NOT NULL UNIQUE CHECK(length(idempotency_hash)=64),
 created_at INTEGER NOT NULL CHECK(created_at>0),
 UNIQUE(topup_request_id,revision)
);
CREATE INDEX IF NOT EXISTS idx_member_topup_corrections_account
 ON family_member_prepaid_topup_corrections(household_id,before_account_id,after_account_id);
CREATE INDEX IF NOT EXISTS idx_member_topup_corrections_owner
 ON family_member_prepaid_topup_corrections(household_id,owner_user_id,created_at DESC);

-- This trigger is also the atomic concurrency guard. It refuses stale revision,
-- foreign assets and a correction that would overdraw the source wallet.
CREATE TRIGGER IF NOT EXISTS trg_member_topup_correction_guard
 BEFORE INSERT ON family_member_prepaid_topup_corrections
 WHEN NOT EXISTS (
  SELECT 1 FROM family_member_prepaid_topups t
  JOIN homeflow_identity_links h ON h.user_id=NEW.owner_user_id AND h.household_id=NEW.household_id
  JOIN family_financial_accounts before_a ON before_a.account_id=NEW.before_account_id
  JOIN family_financial_accounts after_a ON after_a.account_id=NEW.after_account_id
  WHERE t.request_id=NEW.topup_request_id
   AND t.household_id=NEW.household_id AND t.owner_user_id=NEW.owner_user_id
   AND h.role='member' AND h.state='active'
   AND before_a.owner_user_id=NEW.owner_user_id AND before_a.household_id=NEW.household_id
   AND before_a.account_kind='prepaid' AND before_a.origin='member_created'
   AND after_a.owner_user_id=NEW.owner_user_id AND after_a.household_id=NEW.household_id
   AND after_a.account_kind='prepaid' AND after_a.origin='member_created'
   AND after_a.is_archived=0 AND after_a.version=NEW.after_account_version
   AND NEW.revision=1+COALESCE((SELECT MAX(k.revision)
       FROM family_member_prepaid_topup_corrections k
       WHERE k.topup_request_id=NEW.topup_request_id),0)
   AND NEW.before_account_id=COALESCE((SELECT k.after_account_id
       FROM family_member_prepaid_topup_corrections k
       WHERE k.topup_request_id=NEW.topup_request_id
       ORDER BY k.revision DESC LIMIT 1),t.prepaid_account_id)
   AND NEW.before_amount_jpy=COALESCE((SELECT k.after_amount_jpy
       FROM family_member_prepaid_topup_corrections k
       WHERE k.topup_request_id=NEW.topup_request_id
       ORDER BY k.revision DESC LIMIT 1),t.amount_jpy)
   AND NEW.before_effective_date=COALESCE((SELECT k.after_effective_date
       FROM family_member_prepaid_topup_corrections k
       WHERE k.topup_request_id=NEW.topup_request_id
       ORDER BY k.revision DESC LIMIT 1),t.effective_date)
   AND (
     COALESCE((SELECT opening_balance FROM family_financial_accounts WHERE account_id=NEW.before_account_id),0)
     +COALESCE((SELECT SUM(j.delta_jpy) FROM family_prepaid_balance_journal j WHERE j.prepaid_account_id=NEW.before_account_id),0)
     +COALESCE((SELECT SUM(t.amount_jpy) FROM family_member_prepaid_topups t WHERE t.prepaid_account_id=NEW.before_account_id),0)
     +COALESCE((SELECT SUM(c.amount_jpy) FROM family_points_prepaid_credits c WHERE c.prepaid_account_id=NEW.before_account_id),0)
     -COALESCE((SELECT SUM(r.debited_prepaid_jpy) FROM family_points_prepaid_refunds r WHERE r.prepaid_account_id=NEW.before_account_id),0)
     +COALESCE((SELECT SUM(
        (CASE WHEN k.after_account_id=NEW.before_account_id THEN k.after_amount_jpy ELSE 0 END)
       -(CASE WHEN k.before_account_id=NEW.before_account_id THEN k.before_amount_jpy ELSE 0 END)
       ) FROM family_member_prepaid_topup_corrections k WHERE k.household_id=NEW.household_id),0)
     -NEW.before_amount_jpy
     +(CASE WHEN NEW.before_account_id=NEW.after_account_id THEN NEW.after_amount_jpy ELSE 0 END))>=0
 ) BEGIN SELECT RAISE(ABORT,'PERSONAL_TOPUP_CORRECTION_STALE_OR_OVERDRAW'); END;
CREATE TRIGGER IF NOT EXISTS trg_member_topup_correction_immutable_update
 BEFORE UPDATE ON family_member_prepaid_topup_corrections
 BEGIN SELECT RAISE(ABORT,'PERSONAL_TOPUP_CORRECTION_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_member_topup_correction_immutable_delete
 BEFORE DELETE ON family_member_prepaid_topup_corrections
 BEGIN SELECT RAISE(ABORT,'PERSONAL_TOPUP_CORRECTION_IMMUTABLE'); END;

-- Include both sides of a correction when spending from a wallet. Without
-- this, the original spend journal would disagree with the read projections.
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
     +COALESCE((SELECT SUM((CASE WHEN k.after_account_id=NEW.prepaid_account_id THEN k.after_amount_jpy ELSE 0 END)
                         -(CASE WHEN k.before_account_id=NEW.prepaid_account_id THEN k.before_amount_jpy ELSE 0 END))
        FROM family_member_prepaid_topup_corrections k
        WHERE k.before_account_id=NEW.prepaid_account_id OR k.after_account_id=NEW.prepaid_account_id),0)
     +COALESCE((SELECT SUM(c.amount_jpy) FROM family_points_prepaid_credits c WHERE c.prepaid_account_id=NEW.prepaid_account_id),0)
     -COALESCE((SELECT SUM(r.debited_prepaid_jpy) FROM family_points_prepaid_refunds r WHERE r.prepaid_account_id=NEW.prepaid_account_id),0)
     +NEW.delta_jpy AND NEW.balance_after_jpy>=0
 ) BEGIN SELECT RAISE(ABORT,'PREPAID_OVERDRAFT_OR_CONCURRENT_BALANCE'); END;
INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(
 'schema-0075-member-prepaid-topup-corrections',
 'Append-only member owned prepaid topup corrections, atomic two-account balance and concurrency check');
