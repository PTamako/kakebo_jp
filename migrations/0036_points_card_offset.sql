-- 0036 (Draft ONLY): points offsets of already-approved card purchase liabilities.
-- No extra cash income, bank debit, transfer or second expense. Existing bank
-- settlements and points offsets consume the SAME outstanding purchase budget.
ALTER TABLE family_points_intents ADD COLUMN target_purchase_request_id TEXT;
CREATE TRIGGER IF NOT EXISTS trg_points_card_target_immutable
 BEFORE UPDATE OF target_purchase_request_id ON family_points_intents
 BEGIN SELECT RAISE(ABORT,'POINTS_CARD_TARGET_IMMUTABLE'); END;

-- Replace the UNDEPLOYED 0035 target guard with account kind-aware rules.
DROP TRIGGER IF EXISTS trg_points_prepaid_intent_guard;
CREATE TRIGGER IF NOT EXISTS trg_points_prepaid_intent_guard
 BEFORE INSERT ON family_points_intents
 WHEN (NEW.operation IN ('transfer_prepaid','offset_card') AND (
  NEW.target_account_id IS NULL OR NEW.target_version IS NULL OR
  NOT EXISTS(SELECT 1 FROM family_financial_accounts a
   WHERE a.account_id=NEW.target_account_id AND a.household_id=NEW.household_id
   AND a.owner_user_id=NEW.requester_user_id AND a.origin='member_created'
   AND a.is_archived=0 AND a.version=NEW.target_version AND a.opening_balance=0
   AND a.account_kind=CASE WHEN NEW.operation='transfer_prepaid' THEN 'prepaid'
    ELSE 'credit_card' END)))
 OR (NEW.operation NOT IN ('transfer_prepaid','offset_card') AND
  (NEW.target_account_id IS NOT NULL OR NEW.target_version IS NOT NULL))
 OR (NEW.operation='offset_card' AND (
   NEW.target_purchase_request_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM family_card_purchase_applied p
    WHERE p.homeflow_request_id=NEW.target_purchase_request_id
      AND p.account_id=NEW.target_account_id AND p.household_id=NEW.household_id
      AND p.requester_user_id=NEW.requester_user_id)))
 OR (NEW.operation<>'offset_card' AND NEW.target_purchase_request_id IS NOT NULL)
 BEGIN SELECT RAISE(ABORT,'POINTS_TARGET_ACCOUNT_INVALID'); END;

CREATE TABLE IF NOT EXISTS family_points_card_offsets (
 homeflow_request_id TEXT PRIMARY KEY REFERENCES family_points_journal(homeflow_request_id) ON DELETE RESTRICT,
 household_id TEXT NOT NULL,
 requester_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 card_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 card_version INTEGER NOT NULL CHECK(card_version>=1),
 purchase_request_id TEXT NOT NULL REFERENCES family_card_purchase_applied(homeflow_request_id) ON DELETE RESTRICT,
 amount_jpy INTEGER NOT NULL CHECK(amount_jpy BETWEEN 1 AND 10000000),
 remaining_after_jpy INTEGER NOT NULL CHECK(remaining_after_jpy BETWEEN 0 AND 10000000),
 effective_date TEXT NOT NULL CHECK(length(effective_date)=10),
 created_at INTEGER NOT NULL CHECK(created_at>0)
);
CREATE INDEX IF NOT EXISTS idx_points_card_offsets_purchase
 ON family_points_card_offsets(purchase_request_id,created_at);
CREATE INDEX IF NOT EXISTS idx_points_card_offsets_card
 ON family_points_card_offsets(household_id,card_account_id);

CREATE TRIGGER IF NOT EXISTS trg_points_card_offset_guard
 BEFORE INSERT ON family_points_card_offsets
 WHEN NOT EXISTS(
  SELECT 1 FROM family_points_journal j
  JOIN family_points_intents intent ON intent.request_id=j.proposal_id
  JOIN family_card_purchase_applied purchase ON
   purchase.homeflow_request_id=NEW.purchase_request_id
  JOIN family_financial_accounts card ON card.account_id=NEW.card_account_id
  WHERE j.homeflow_request_id=NEW.homeflow_request_id
   AND j.operation='offset_card' AND j.delta_units<0 AND j.yen_value=NEW.amount_jpy
   AND j.target_account_id=NEW.card_account_id AND j.household_id=NEW.household_id
   AND j.requester_user_id=NEW.requester_user_id AND j.effective_date=NEW.effective_date
   AND j.applied_at=NEW.created_at AND intent.target_account_id=NEW.card_account_id
   AND intent.target_version=NEW.card_version
   AND intent.target_purchase_request_id=NEW.purchase_request_id
   AND card.account_kind='credit_card' AND card.origin='member_created'
   AND card.opening_balance=0 AND card.is_archived=0
   AND card.version=NEW.card_version AND card.household_id=NEW.household_id
   AND card.owner_user_id=NEW.requester_user_id
   AND purchase.household_id=NEW.household_id
   AND purchase.requester_user_id=NEW.requester_user_id
   AND purchase.account_id=NEW.card_account_id
   AND purchase.purchase_date<=NEW.effective_date
   AND NEW.remaining_after_jpy=
     purchase.amount_jpy
     -COALESCE((SELECT SUM(a.amount_jpy) FROM family_card_settlement_allocations a
       WHERE a.purchase_request_id=NEW.purchase_request_id),0)
     -COALESCE((SELECT SUM(o.amount_jpy) FROM family_points_card_offsets o
       WHERE o.purchase_request_id=NEW.purchase_request_id),0)
     -NEW.amount_jpy
 )
 BEGIN SELECT RAISE(ABORT,'POINTS_CARD_OFFSET_OVERPAY_OR_OWNER'); END;
CREATE TRIGGER IF NOT EXISTS trg_points_card_offset_immutable_update
 BEFORE UPDATE ON family_points_card_offsets
 BEGIN SELECT RAISE(ABORT,'POINTS_CARD_OFFSET_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_points_card_offset_immutable_delete
 BEFORE DELETE ON family_points_card_offsets
 BEGIN SELECT RAISE(ABORT,'POINTS_CARD_OFFSET_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS trg_points_card_atomic_post
 AFTER INSERT ON family_points_journal
 WHEN NEW.operation='offset_card'
 BEGIN
  SELECT RAISE(ABORT,'POINTS_CARD_TARGET_INVALID')
   WHERE NEW.yen_value IS NULL OR NEW.yen_value NOT BETWEEN 1 AND 10000000
   OR NEW.target_account_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM family_points_intents i
    JOIN family_financial_accounts c ON c.account_id=i.target_account_id
    JOIN family_card_purchase_applied p
     ON p.homeflow_request_id=i.target_purchase_request_id
    WHERE i.request_id=NEW.proposal_id AND i.target_account_id=NEW.target_account_id
     AND i.target_version=c.version AND c.account_kind='credit_card'
     AND c.origin='member_created' AND c.is_archived=0 AND c.opening_balance=0
     AND c.household_id=NEW.household_id AND c.owner_user_id=NEW.requester_user_id
     AND p.account_id=c.account_id AND p.household_id=c.household_id
     AND p.requester_user_id=NEW.requester_user_id
     AND p.purchase_date<=NEW.effective_date);
  INSERT INTO family_points_card_offsets
   (homeflow_request_id,household_id,requester_user_id,card_account_id,card_version,
    purchase_request_id,amount_jpy,remaining_after_jpy,effective_date,created_at)
   SELECT NEW.homeflow_request_id,NEW.household_id,NEW.requester_user_id,
    NEW.target_account_id,i.target_version,i.target_purchase_request_id,NEW.yen_value,
    p.amount_jpy
      -COALESCE((SELECT SUM(a.amount_jpy) FROM family_card_settlement_allocations a
        WHERE a.purchase_request_id=i.target_purchase_request_id),0)
      -COALESCE((SELECT SUM(o.amount_jpy) FROM family_points_card_offsets o
        WHERE o.purchase_request_id=i.target_purchase_request_id),0)-NEW.yen_value,
    NEW.effective_date,NEW.applied_at
   FROM family_points_intents i JOIN family_card_purchase_applied p
    ON p.homeflow_request_id=i.target_purchase_request_id
   WHERE i.request_id=NEW.proposal_id;
 END;

-- Existing bank allocations must subtract preexisting points offsets before
-- accepting new cash settlement. Both triggers run under SQLite writer lock.
DROP TRIGGER IF EXISTS trg_family_card_allocation_balance;
CREATE TRIGGER IF NOT EXISTS trg_family_card_allocation_balance
 BEFORE INSERT ON family_card_settlement_allocations
 WHEN NOT EXISTS(
 SELECT 1 FROM family_card_purchase_applied p
 JOIN family_card_settlements_applied s ON s.homeflow_request_id=NEW.homeflow_request_id
 WHERE p.homeflow_request_id=NEW.purchase_request_id
 AND p.household_id=s.household_id AND p.account_id=s.card_account_id
 AND p.purchase_date<=s.debit_date
 AND NEW.amount_jpy<=p.amount_jpy-COALESCE((
  SELECT SUM(a.amount_jpy) FROM family_card_settlement_allocations a
  WHERE a.purchase_request_id=NEW.purchase_request_id),0)-COALESCE((
  SELECT SUM(o.amount_jpy) FROM family_points_card_offsets o
  WHERE o.purchase_request_id=NEW.purchase_request_id),0))
 BEGIN SELECT RAISE(ABORT,'CARD_SETTLEMENT_OVERPAY_OR_WRONG_ACCOUNT'); END;

INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(
 'schema-0036-points-card-offset','Unexecuted Draft card liability points offset with shared bank settlement allocation budget');
