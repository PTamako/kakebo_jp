-- 0038 P0-4A Draft: immutable correction of ORIGINAL earn/expire events only.
-- The correction never edits the original and never creates cash entries.
-- This stage deliberately blocks reversals with external counterparts:
-- prepaid, credit-card offset, other points, SBI, redeem_purchase/discount.
ALTER TABLE family_points_intents ADD COLUMN original_request_id TEXT;
CREATE TRIGGER IF NOT EXISTS trg_points_reversal_intent_immutable
 BEFORE UPDATE OF original_request_id ON family_points_intents
 BEGIN SELECT RAISE(ABORT,'POINTS_REVERSAL_INTENT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_points_reversal_intent_guard
 BEFORE INSERT ON family_points_intents
 WHEN (NEW.operation='reversal' AND (
  NEW.original_request_id IS NULL OR NOT EXISTS (
   SELECT 1 FROM family_points_journal old
   WHERE old.homeflow_request_id=NEW.original_request_id
    AND old.operation IN ('earn_campaign','earn_purchase','expire')
    AND old.points_account_id=NEW.points_account_id
    AND old.household_id=NEW.household_id
    AND old.requester_user_id=NEW.requester_user_id
    AND old.target_account_id IS NULL
    AND NOT EXISTS(SELECT 1 FROM family_points_journal prior
     WHERE prior.reversed_request_id=old.homeflow_request_id))))
 OR (NEW.operation<>'reversal' AND NEW.original_request_id IS NOT NULL)
 BEGIN SELECT RAISE(ABORT,'POINTS_REVERSAL_ORIGINAL_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS trg_points_reversal_journal_guard
 BEFORE INSERT ON family_points_journal
 WHEN NEW.operation='reversal' AND NOT EXISTS(
  SELECT 1 FROM family_points_journal old
  JOIN family_points_intents intent ON intent.request_id=NEW.proposal_id
  WHERE intent.original_request_id=old.homeflow_request_id
   AND old.homeflow_request_id=NEW.reversed_request_id
   AND old.operation IN ('earn_campaign','earn_purchase','expire')
   AND old.points_account_id=NEW.points_account_id
   AND old.household_id=NEW.household_id
   AND old.requester_user_id=NEW.requester_user_id
   AND old.target_account_id IS NULL
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

INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(
 'schema-0038-points-reversal-earn-expire',
 'Unexecuted Draft signed and owner-approved immutable reversal of earn/expiry only; external counterpart reversals blocked');
