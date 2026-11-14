-- 0035 (Draft ONLY): atomic points redemption into a member-owned prepaid account.
-- This migration MUST be run after 0033 and 0034. Not a legacy Suica backfill.
-- A points INSERT automatically credits prepaid through SQLite triggers; failure
-- of either half rolls back the entire INSERT, including its actor audit.
ALTER TABLE family_points_intents ADD COLUMN target_account_id TEXT;
ALTER TABLE family_points_intents ADD COLUMN target_version INTEGER;
CREATE TRIGGER IF NOT EXISTS trg_points_target_intent_immutable
 BEFORE UPDATE OF target_account_id,target_version ON family_points_intents
 BEGIN SELECT RAISE(ABORT,'POINTS_TARGET_INTENT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_points_prepaid_intent_guard
 BEFORE INSERT ON family_points_intents
 WHEN (NEW.operation='transfer_prepaid' AND (
  NEW.target_account_id IS NULL OR NEW.target_version IS NULL OR
  NOT EXISTS (SELECT 1 FROM family_financial_accounts a
   WHERE a.account_id=NEW.target_account_id AND a.account_kind='prepaid'
    AND a.household_id=NEW.household_id AND a.owner_user_id=NEW.requester_user_id
    AND a.origin='member_created' AND a.is_archived=0
    AND a.version=NEW.target_version AND a.opening_balance=0)))
 OR (NEW.operation<>'transfer_prepaid' AND
  (NEW.target_account_id IS NOT NULL OR NEW.target_version IS NOT NULL))
 BEGIN SELECT RAISE(ABORT,'POINTS_TARGET_ACCOUNT_INVALID'); END;

CREATE TABLE IF NOT EXISTS family_points_prepaid_credits (
 homeflow_request_id TEXT PRIMARY KEY REFERENCES family_points_journal(homeflow_request_id) ON DELETE RESTRICT,
 household_id TEXT NOT NULL,
 requester_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 prepaid_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 prepaid_version INTEGER NOT NULL CHECK(prepaid_version>=1),
 amount_jpy INTEGER NOT NULL CHECK(amount_jpy BETWEEN 1 AND 10000000),
 balance_after_jpy INTEGER NOT NULL CHECK(balance_after_jpy BETWEEN 0 AND 100000000),
 effective_date TEXT NOT NULL CHECK(length(effective_date)=10),
 created_at INTEGER NOT NULL CHECK(created_at>0)
);
CREATE INDEX IF NOT EXISTS idx_points_prepaid_credits_account
 ON family_points_prepaid_credits(household_id,prepaid_account_id,created_at);

-- The credited prepaid amount must equal the verified points JPY valuation.
-- A separate account name/label or another household can never be a target.
CREATE TRIGGER IF NOT EXISTS trg_points_prepaid_credit_guard
 BEFORE INSERT ON family_points_prepaid_credits
 WHEN NOT EXISTS (
 SELECT 1 FROM family_points_journal j
 JOIN family_points_intents i ON i.request_id=j.proposal_id
 JOIN family_financial_accounts a ON a.account_id=NEW.prepaid_account_id
 WHERE j.homeflow_request_id=NEW.homeflow_request_id
   AND j.operation='transfer_prepaid' AND j.delta_units<0
   AND j.household_id=NEW.household_id AND j.requester_user_id=NEW.requester_user_id
   AND j.target_account_id=NEW.prepaid_account_id AND j.yen_value=NEW.amount_jpy
   AND j.effective_date=NEW.effective_date AND j.applied_at=NEW.created_at
   AND i.target_account_id=NEW.prepaid_account_id AND i.target_version=NEW.prepaid_version
   AND a.account_kind='prepaid' AND a.origin='member_created'
   AND a.opening_balance=0 AND a.is_archived=0 AND a.version=NEW.prepaid_version
   AND a.household_id=NEW.household_id AND a.owner_user_id=NEW.requester_user_id
   AND NEW.balance_after_jpy=
    COALESCE((SELECT SUM(p.delta_jpy) FROM family_prepaid_balance_journal p
     WHERE p.prepaid_account_id=NEW.prepaid_account_id),0)
    +COALESCE((SELECT SUM(c.amount_jpy) FROM family_points_prepaid_credits c
     WHERE c.prepaid_account_id=NEW.prepaid_account_id),0)+NEW.amount_jpy
 )
 BEGIN SELECT RAISE(ABORT,'POINTS_PREPAID_COUNTERPART_INVARIANT'); END;
CREATE TRIGGER IF NOT EXISTS trg_points_prepaid_credit_immutable_update
 BEFORE UPDATE ON family_points_prepaid_credits
 BEGIN SELECT RAISE(ABORT,'POINTS_PREPAID_CREDIT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_points_prepaid_credit_immutable_delete
 BEFORE DELETE ON family_points_prepaid_credits
 BEGIN SELECT RAISE(ABORT,'POINTS_PREPAID_CREDIT_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS trg_points_prepaid_atomic_posting
 AFTER INSERT ON family_points_journal
 WHEN NEW.operation='transfer_prepaid'
 BEGIN
  SELECT RAISE(ABORT,'POINTS_PREPAID_SOURCE_INVALID') WHERE
   NEW.yen_value IS NULL OR NEW.yen_value NOT BETWEEN 1 AND 10000000
   OR NEW.target_account_id IS NULL
   OR NOT EXISTS (
    SELECT 1 FROM family_points_intents i JOIN family_financial_accounts a
     ON a.account_id=i.target_account_id
    WHERE i.request_id=NEW.proposal_id
     AND i.target_account_id=NEW.target_account_id AND i.target_version=a.version
     AND a.account_kind='prepaid' AND a.origin='member_created'
     AND a.opening_balance=0 AND a.is_archived=0
     AND a.household_id=NEW.household_id AND a.owner_user_id=NEW.requester_user_id);
  INSERT INTO family_points_prepaid_credits
   (homeflow_request_id,household_id,requester_user_id,prepaid_account_id,
    prepaid_version,amount_jpy,balance_after_jpy,effective_date,created_at)
   SELECT NEW.homeflow_request_id,NEW.household_id,NEW.requester_user_id,NEW.target_account_id,
    i.target_version,NEW.yen_value,
    COALESCE((SELECT SUM(p.delta_jpy) FROM family_prepaid_balance_journal p
     WHERE p.prepaid_account_id=NEW.target_account_id),0)
    +COALESCE((SELECT SUM(c.amount_jpy) FROM family_points_prepaid_credits c
     WHERE c.prepaid_account_id=NEW.target_account_id),0)+NEW.yen_value,
    NEW.effective_date,NEW.applied_at
   FROM family_points_intents i WHERE i.request_id=NEW.proposal_id;
 END;

-- The old prepaid spend/topup balance invariant must see BOTH posting sources.
-- We replace only this UNDEPLOYED trigger; no historic entries are rewritten.
DROP TRIGGER IF EXISTS trg_family_prepaid_balance_atomic;
CREATE TRIGGER IF NOT EXISTS trg_family_prepaid_balance_atomic
 BEFORE INSERT ON family_prepaid_balance_journal
 WHEN NOT EXISTS(
  SELECT 1 FROM family_prepaid_actions_applied a
  WHERE a.homeflow_request_id=NEW.homeflow_request_id
  AND a.household_id=NEW.household_id
  AND a.prepaid_account_id=NEW.prepaid_account_id
  AND a.date=NEW.effective_date
  AND a.balance_after_jpy=NEW.balance_after_jpy
  AND NEW.delta_jpy=CASE WHEN a.action='topup' THEN a.amount_jpy ELSE -a.amount_jpy END
  AND NEW.balance_after_jpy=
   COALESCE((SELECT SUM(j.delta_jpy) FROM family_prepaid_balance_journal j
    WHERE j.prepaid_account_id=NEW.prepaid_account_id),0)
   +COALESCE((SELECT SUM(c.amount_jpy) FROM family_points_prepaid_credits c
    WHERE c.prepaid_account_id=NEW.prepaid_account_id),0)+NEW.delta_jpy
  AND NEW.balance_after_jpy>=0
 )
 BEGIN SELECT RAISE(ABORT,'PREPAID_OVERDRAFT_OR_CONCURRENT_BALANCE'); END;

INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(
 'schema-0035-points-prepaid-atomic','Unexecuted Draft atomic points debit and prepaid credit; no cash income and no legacy backfill');
