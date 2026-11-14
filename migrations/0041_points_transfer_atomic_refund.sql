-- 0041 Draft: immutable dual-sided refund of transfer_out / exchange_out.
-- The original source journal AND original target credits remain immutable.
-- The NEW reversal journal restores source units, and its AFTER trigger
-- removes original target units in the SAME SQLite statement. Reject on
-- negative recipient available units, stale target version, or actor mismatch.
CREATE TABLE IF NOT EXISTS family_points_transfer_refunds (
 homeflow_request_id TEXT PRIMARY KEY REFERENCES family_points_journal(homeflow_request_id) ON DELETE RESTRICT,
 original_request_id TEXT NOT NULL UNIQUE REFERENCES family_points_transfer_credits(homeflow_request_id) ON DELETE RESTRICT,
 household_id TEXT NOT NULL,
 requester_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 source_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 target_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 target_version INTEGER NOT NULL CHECK(target_version>=1),
 debited_target_units INTEGER NOT NULL CHECK(debited_target_units BETWEEN 1 AND 1000000000),
 target_balance_after_units INTEGER NOT NULL CHECK(target_balance_after_units BETWEEN 0 AND 1000000000000),
 yen_value INTEGER NOT NULL CHECK(yen_value BETWEEN 1 AND 1000000000),
 effective_date TEXT NOT NULL CHECK(length(effective_date)=10),
 created_at INTEGER NOT NULL CHECK(created_at>0)
);
CREATE INDEX IF NOT EXISTS idx_points_refund_target
 ON family_points_transfer_refunds(household_id,target_account_id,created_at);
CREATE TRIGGER IF NOT EXISTS trg_points_transfer_refund_guard
 BEFORE INSERT ON family_points_transfer_refunds
 WHEN NOT EXISTS(
  SELECT 1 FROM family_points_journal reversal
  JOIN family_points_journal original ON original.homeflow_request_id=NEW.original_request_id
  JOIN family_points_transfer_credits credit ON credit.homeflow_request_id=original.homeflow_request_id
  JOIN family_financial_accounts target ON target.account_id=credit.target_account_id
  JOIN family_points_intents intent ON intent.request_id=reversal.proposal_id
  WHERE reversal.homeflow_request_id=NEW.homeflow_request_id
   AND reversal.operation='reversal'
   AND reversal.reversed_request_id=original.homeflow_request_id
   AND reversal.delta_units=-original.delta_units
   AND reversal.delta_units>0
   AND reversal.points_account_id=NEW.source_account_id
   AND reversal.target_account_id=NEW.target_account_id
   AND reversal.household_id=NEW.household_id
   AND reversal.requester_user_id=NEW.requester_user_id
   AND reversal.yen_value=NEW.yen_value
   AND reversal.effective_date=NEW.effective_date AND reversal.applied_at=NEW.created_at
   AND intent.original_request_id=original.homeflow_request_id
   AND original.operation IN ('transfer_out','exchange_out')
   AND original.target_account_id=NEW.target_account_id
   AND original.points_account_id=NEW.source_account_id
   AND original.household_id=NEW.household_id
   AND original.requester_user_id=NEW.requester_user_id
   AND original.yen_value=NEW.yen_value
   AND credit.target_account_id=NEW.target_account_id
   AND credit.target_version=NEW.target_version
   AND credit.target_units=NEW.debited_target_units
   AND credit.household_id=NEW.household_id
   AND credit.requester_user_id=NEW.requester_user_id
   AND target.account_kind='points' AND target.origin='member_created'
   AND target.opening_balance=0 AND target.is_archived=0
   AND target.version=NEW.target_version
   AND target.household_id=NEW.household_id AND target.owner_user_id=NEW.requester_user_id
   AND NEW.target_balance_after_units=
    COALESCE((SELECT SUM(j.delta_units) FROM family_points_journal j
     WHERE j.points_account_id=NEW.target_account_id),0)
    +COALESCE((SELECT SUM(c.target_units) FROM family_points_transfer_credits c
     WHERE c.target_account_id=NEW.target_account_id),0)
    -COALESCE((SELECT SUM(r.debited_target_units) FROM family_points_transfer_refunds r
     WHERE r.target_account_id=NEW.target_account_id),0)-NEW.debited_target_units
 )
 BEGIN SELECT RAISE(ABORT,'POINTS_TRANSFER_REFUND_INSUFFICIENT_OR_WRONG_TARGET'); END;
CREATE TRIGGER IF NOT EXISTS trg_points_transfer_refund_no_update
 BEFORE UPDATE ON family_points_transfer_refunds
 BEGIN SELECT RAISE(ABORT,'POINTS_TRANSFER_REFUND_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_points_transfer_refund_no_delete
 BEFORE DELETE ON family_points_transfer_refunds
 BEGIN SELECT RAISE(ABORT,'POINTS_TRANSFER_REFUND_IMMUTABLE'); END;

DROP TRIGGER IF EXISTS trg_points_reversal_intent_guard;
CREATE TRIGGER IF NOT EXISTS trg_points_reversal_intent_guard
 BEFORE INSERT ON family_points_intents
 WHEN (NEW.operation='reversal' AND (
  NEW.original_request_id IS NULL OR NOT EXISTS (
   SELECT 1 FROM family_points_journal old
   WHERE old.homeflow_request_id=NEW.original_request_id
    AND old.operation IN ('earn_campaign','earn_purchase','expire','transfer_out','exchange_out')
    AND old.points_account_id=NEW.points_account_id
    AND old.household_id=NEW.household_id
    AND old.requester_user_id=NEW.requester_user_id
    AND (
      old.target_account_id IS NULL
      OR (old.operation IN ('transfer_out','exchange_out') AND EXISTS(
        SELECT 1 FROM family_points_transfer_credits original_credit
        JOIN family_financial_accounts target ON target.account_id=original_credit.target_account_id
        WHERE original_credit.homeflow_request_id=old.homeflow_request_id
          AND original_credit.target_account_id=old.target_account_id
          AND original_credit.household_id=old.household_id
          AND original_credit.requester_user_id=old.requester_user_id
          AND target.owner_user_id=old.requester_user_id
          AND target.household_id=old.household_id
          AND target.origin='member_created' AND target.account_kind='points'
          AND target.opening_balance=0 AND target.is_archived=0
          AND target.version=original_credit.target_version
          AND original_credit.target_units <=
             COALESCE((SELECT SUM(j.delta_units) FROM family_points_journal j
              WHERE j.points_account_id=original_credit.target_account_id),0)
            +COALESCE((SELECT SUM(t.target_units) FROM family_points_transfer_credits t
              WHERE t.target_account_id=original_credit.target_account_id),0)
            -COALESCE((SELECT SUM(ref.debited_target_units) FROM family_points_transfer_refunds ref
              WHERE ref.target_account_id=original_credit.target_account_id),0)
       ))
    )
    AND NOT EXISTS(SELECT 1 FROM family_points_journal prior
     WHERE prior.reversed_request_id=old.homeflow_request_id))))
 OR (NEW.operation<>'reversal' AND NEW.original_request_id IS NOT NULL)
 BEGIN SELECT RAISE(ABORT,'POINTS_REVERSAL_ORIGINAL_INVALID'); END;
DROP TRIGGER IF EXISTS trg_points_reversal_journal_guard;
CREATE TRIGGER IF NOT EXISTS trg_points_reversal_journal_guard
 BEFORE INSERT ON family_points_journal
 WHEN NEW.operation='reversal' AND NOT EXISTS(
  SELECT 1 FROM family_points_journal old
  JOIN family_points_intents intent ON intent.request_id=NEW.proposal_id
  WHERE intent.original_request_id=old.homeflow_request_id
   AND old.homeflow_request_id=NEW.reversed_request_id
   AND old.operation IN ('earn_campaign','earn_purchase','expire','transfer_out','exchange_out')
   AND old.points_account_id=NEW.points_account_id
   AND old.household_id=NEW.household_id
   AND old.requester_user_id=NEW.requester_user_id
   AND (
      old.target_account_id IS NULL
      OR (old.operation IN ('transfer_out','exchange_out') AND EXISTS(
        SELECT 1 FROM family_points_transfer_credits original_credit
        JOIN family_financial_accounts target ON target.account_id=original_credit.target_account_id
        WHERE original_credit.homeflow_request_id=old.homeflow_request_id
          AND original_credit.target_account_id=old.target_account_id
          AND original_credit.household_id=old.household_id
          AND original_credit.requester_user_id=old.requester_user_id
          AND target.owner_user_id=old.requester_user_id
          AND target.household_id=old.household_id
          AND target.origin='member_created' AND target.account_kind='points'
          AND target.opening_balance=0 AND target.is_archived=0
          AND target.version=original_credit.target_version
          AND original_credit.target_units <=
             COALESCE((SELECT SUM(j.delta_units) FROM family_points_journal j
              WHERE j.points_account_id=original_credit.target_account_id),0)
            +COALESCE((SELECT SUM(t.target_units) FROM family_points_transfer_credits t
              WHERE t.target_account_id=original_credit.target_account_id),0)
            -COALESCE((SELECT SUM(ref.debited_target_units) FROM family_points_transfer_refunds ref
              WHERE ref.target_account_id=original_credit.target_account_id),0)
       ))
    )
   AND NEW.delta_units=-old.delta_units
   AND NEW.yen_value IS old.yen_value
   AND NEW.yen_per_unit_numerator IS old.yen_per_unit_numerator
   AND NEW.yen_per_unit_denominator IS old.yen_per_unit_denominator
   AND NEW.target_account_id IS old.target_account_id
   AND NEW.linked_entry_id IS old.linked_entry_id
   AND NEW.effective_date>=old.effective_date
   AND NOT EXISTS(SELECT 1 FROM family_points_journal previous
    WHERE previous.reversed_request_id=old.homeflow_request_id)
 )
 BEGIN SELECT RAISE(ABORT,'POINTS_REVERSAL_COUNTER_JOURNAL_INVALID'); END;
DROP TRIGGER IF EXISTS trg_family_points_journal_guard;
CREATE TRIGGER IF NOT EXISTS trg_family_points_journal_guard
 BEFORE INSERT ON family_points_journal
 WHEN NOT EXISTS (
   SELECT 1 FROM family_points_intents p
   JOIN family_financial_accounts a ON a.account_id=p.points_account_id
   JOIN homeflow_identity_links requester ON requester.user_id=p.requester_user_id
   JOIN homeflow_identity_links approver ON approver.user_id=NEW.approver_user_id
   WHERE p.request_id=NEW.proposal_id AND p.homeflow_approval_id=NEW.homeflow_request_id
    AND p.status='submitted' AND p.household_id=NEW.household_id
    AND p.requester_user_id=NEW.requester_user_id AND p.points_account_id=NEW.points_account_id
    AND p.expected_version=NEW.account_version AND p.operation=NEW.operation
    AND p.payload_sha256=NEW.payload_sha256 AND p.expires_at>NEW.applied_at
    AND a.account_kind='points' AND a.origin='member_created' AND a.opening_balance=0
    AND a.is_archived=0 AND a.version=NEW.account_version
    AND a.owner_user_id=NEW.requester_user_id AND a.household_id=NEW.household_id
    AND requester.state='active' AND requester.role='member'
    AND requester.household_id=NEW.household_id
    AND approver.state='active' AND approver.role='owner'
    AND approver.household_id=NEW.household_id
    AND NEW.actor_user_id=NEW.approver_user_id AND NEW.approver_user_id<>NEW.requester_user_id
 )
 OR NEW.balance_after_units<>COALESCE(
     (SELECT SUM(delta_units) FROM family_points_journal
      WHERE points_account_id=NEW.points_account_id),0)
   +COALESCE((SELECT SUM(c.target_units) FROM family_points_transfer_credits c
      WHERE c.target_account_id=NEW.points_account_id),0)
   -COALESCE((SELECT SUM(r.debited_target_units) FROM family_points_transfer_refunds r
      WHERE r.target_account_id=NEW.points_account_id),0)+NEW.delta_units
 OR (NEW.operation IN ('earn_purchase','earn_campaign','transfer_in') AND NEW.delta_units<=0)
 OR (NEW.operation IN ('redeem_discount','redeem_purchase','redeem_asset',
     'transfer_prepaid','offset_card','exchange_out','transfer_out','expire')
     AND NEW.delta_units>=0)
 OR (NEW.operation IN ('earn_purchase','earn_campaign') AND
     NEW.linked_entry_id IS NULL AND NEW.source_reference_hash IS NULL)
 OR (NEW.operation IN ('redeem_discount','redeem_purchase') AND NEW.linked_entry_id IS NULL)
 OR (NEW.operation IN ('transfer_prepaid','offset_card','redeem_asset','exchange_out',
     'transfer_out','transfer_in') AND NEW.target_account_id IS NULL)
 OR (NEW.target_account_id IS NOT NULL AND NOT EXISTS (
     SELECT 1 FROM family_financial_accounts a
     WHERE a.account_id=NEW.target_account_id AND a.household_id=NEW.household_id
       AND a.is_archived=0 AND a.origin='member_created'
       AND a.account_kind=CASE
         WHEN NEW.operation='transfer_prepaid' THEN 'prepaid'
         WHEN NEW.operation='offset_card' THEN 'credit_card'
         WHEN NEW.operation='redeem_asset' THEN 'securities'
         ELSE 'points' END))
 OR (NEW.operation='reversal' AND NOT EXISTS (
     SELECT 1 FROM family_points_journal old
     WHERE old.homeflow_request_id=NEW.reversed_request_id
       AND old.points_account_id=NEW.points_account_id
       AND old.operation<>'reversal' AND NEW.delta_units=-old.delta_units
       AND NEW.yen_value IS old.yen_value
       AND NEW.target_account_id IS old.target_account_id
       AND NEW.linked_entry_id IS old.linked_entry_id))
 BEGIN SELECT RAISE(ABORT,'POINTS_JOURNAL_INVARIANT'); END;
DROP TRIGGER IF EXISTS trg_points_transfer_credit_guard;
CREATE TRIGGER IF NOT EXISTS trg_points_transfer_credit_guard
 BEFORE INSERT ON family_points_transfer_credits
 WHEN NOT EXISTS(
  SELECT 1 FROM family_points_journal j
  JOIN family_points_intents i ON i.request_id=j.proposal_id
  JOIN family_financial_accounts a ON a.account_id=NEW.target_account_id
  WHERE j.homeflow_request_id=NEW.homeflow_request_id
   AND j.operation=NEW.operation AND j.delta_units<0
   AND j.household_id=NEW.household_id AND j.requester_user_id=NEW.requester_user_id
   AND j.points_account_id=NEW.source_account_id AND j.target_account_id=NEW.target_account_id
   AND j.yen_value=NEW.yen_value AND j.effective_date=NEW.effective_date
   AND j.applied_at=NEW.created_at
   AND i.target_account_id=NEW.target_account_id AND i.target_version=NEW.target_version
   AND i.target_units=NEW.target_units AND i.target_rate_numerator=NEW.target_rate_numerator
   AND i.target_rate_denominator=NEW.target_rate_denominator
   AND a.account_kind='points' AND a.origin='member_created' AND a.opening_balance=0
   AND a.is_archived=0 AND a.version=NEW.target_version
   AND a.household_id=NEW.household_id AND a.owner_user_id=NEW.requester_user_id
   AND (NEW.operation<>'transfer_out' OR (
    NEW.target_units=-j.delta_units
    AND NEW.target_rate_numerator=j.yen_per_unit_numerator
    AND NEW.target_rate_denominator=j.yen_per_unit_denominator))
   AND NEW.target_balance_after_units=
    COALESCE((SELECT SUM(s.delta_units) FROM family_points_journal s
     WHERE s.points_account_id=NEW.target_account_id),0)
    +COALESCE((SELECT SUM(t.target_units) FROM family_points_transfer_credits t
     WHERE t.target_account_id=NEW.target_account_id),0)
    -COALESCE((SELECT SUM(r.debited_target_units) FROM family_points_transfer_refunds r
      WHERE r.target_account_id=NEW.target_account_id),0)+NEW.target_units
 )
 BEGIN SELECT RAISE(ABORT,'POINTS_TRANSFER_COUNTERPART_INVARIANT'); END;
DROP TRIGGER IF EXISTS trg_points_transfer_atomic_post;
CREATE TRIGGER IF NOT EXISTS trg_points_transfer_atomic_post
 AFTER INSERT ON family_points_journal
 WHEN NEW.operation IN ('transfer_out','exchange_out')
 BEGIN
  SELECT RAISE(ABORT,'POINTS_TRANSFER_SOURCE_INVALID') WHERE
   NEW.delta_units>=0 OR NEW.yen_value IS NULL OR NEW.yen_value<=0
   OR NEW.target_account_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM family_points_intents i
    JOIN family_financial_accounts a ON a.account_id=i.target_account_id
    WHERE i.request_id=NEW.proposal_id AND i.target_account_id=NEW.target_account_id
     AND a.account_kind='points' AND a.origin='member_created'
     AND a.opening_balance=0 AND a.is_archived=0 AND a.version=i.target_version
     AND a.household_id=NEW.household_id AND a.owner_user_id=NEW.requester_user_id);
  INSERT INTO family_points_transfer_credits
   (homeflow_request_id,household_id,requester_user_id,source_account_id,target_account_id,
    target_version,operation,target_units,target_balance_after_units,yen_value,
    target_rate_numerator,target_rate_denominator,effective_date,created_at)
   SELECT NEW.homeflow_request_id,NEW.household_id,NEW.requester_user_id,
    NEW.points_account_id,NEW.target_account_id,i.target_version,NEW.operation,
    i.target_units,
    COALESCE((SELECT SUM(s.delta_units) FROM family_points_journal s
      WHERE s.points_account_id=NEW.target_account_id),0)
    +COALESCE((SELECT SUM(t.target_units) FROM family_points_transfer_credits t
      WHERE t.target_account_id=NEW.target_account_id),0)
    -COALESCE((SELECT SUM(r.debited_target_units) FROM family_points_transfer_refunds r
      WHERE r.target_account_id=NEW.target_account_id),0)+i.target_units,
    NEW.yen_value,i.target_rate_numerator,i.target_rate_denominator,
    NEW.effective_date,NEW.applied_at
   FROM family_points_intents i WHERE i.request_id=NEW.proposal_id;
 END;

CREATE TRIGGER IF NOT EXISTS trg_points_transfer_refund_atomic_post
 AFTER INSERT ON family_points_journal
 WHEN NEW.operation='reversal' AND EXISTS(
  SELECT 1 FROM family_points_journal original
  WHERE original.homeflow_request_id=NEW.reversed_request_id
  AND original.operation IN ('transfer_out','exchange_out'))
 BEGIN
  INSERT INTO family_points_transfer_refunds(
   homeflow_request_id,original_request_id,household_id,requester_user_id,
   source_account_id,target_account_id,target_version,debited_target_units,
   target_balance_after_units,yen_value,effective_date,created_at)
  SELECT NEW.homeflow_request_id,old.homeflow_request_id,NEW.household_id,
   NEW.requester_user_id,NEW.points_account_id,c.target_account_id,
   c.target_version,c.target_units,
    COALESCE((SELECT SUM(j.delta_units) FROM family_points_journal j
     WHERE j.points_account_id=c.target_account_id),0)
    +COALESCE((SELECT SUM(t.target_units) FROM family_points_transfer_credits t
     WHERE t.target_account_id=c.target_account_id),0)
    -COALESCE((SELECT SUM(r.debited_target_units) FROM family_points_transfer_refunds r
     WHERE r.target_account_id=c.target_account_id),0)-c.target_units,
   old.yen_value,NEW.effective_date,NEW.applied_at
  FROM family_points_journal old
  JOIN family_points_transfer_credits c ON c.homeflow_request_id=old.homeflow_request_id
  WHERE old.homeflow_request_id=NEW.reversed_request_id;
 END;

INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(
 'schema-0041-points-transfer-atomic-refund',
 'UNDEPLOYED single-D1 compensating target credit debit and source reversal with nonnegative target balance');
