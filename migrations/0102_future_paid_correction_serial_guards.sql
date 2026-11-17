-- 0102 serialized final-delta constraints, future-only correction rows.
-- Reject an overdraft at the EXACT D1 INSERT that books the correction, not
-- just from a preapproval balance displayed in another request.
CREATE TRIGGER IF NOT EXISTS trg_future_prepaid_effect_nonnegative
 BEFORE INSERT ON family_approved_account_effects
 WHEN NEW.account_kind='prepaid' AND (
   COALESCE((SELECT SUM(j.delta_jpy) FROM family_prepaid_balance_journal j
    WHERE j.prepaid_account_id=NEW.account_id AND j.household_id=NEW.household_id),0)
  +COALESCE((SELECT SUM(t.amount_jpy) FROM family_member_prepaid_topups t
    WHERE t.prepaid_account_id=NEW.account_id AND t.household_id=NEW.household_id),0)
  +COALESCE((SELECT SUM(c.amount_jpy) FROM family_points_prepaid_credits c
    WHERE c.prepaid_account_id=NEW.account_id AND c.household_id=NEW.household_id),0)
  +COALESCE((SELECT SUM((CASE WHEN k.after_account_id=NEW.account_id THEN k.after_amount_jpy ELSE 0 END)
                     -(CASE WHEN k.before_account_id=NEW.account_id THEN k.before_amount_jpy ELSE 0 END))
    FROM family_member_prepaid_topup_corrections k
    WHERE k.household_id=NEW.household_id
      AND (k.before_account_id=NEW.account_id OR k.after_account_id=NEW.account_id)),0)
  -COALESCE((SELECT SUM(r.debited_prepaid_jpy) FROM family_points_prepaid_refunds r
    WHERE r.prepaid_account_id=NEW.account_id AND r.household_id=NEW.household_id),0)
  +COALESCE((SELECT SUM(e.delta_jpy) FROM family_approved_account_effects e
    WHERE e.account_id=NEW.account_id AND e.account_kind='prepaid'
     AND e.household_id=NEW.household_id),0)
  +NEW.delta_jpy NOT BETWEEN 0 AND 100000000
 )
 BEGIN SELECT RAISE(ABORT,'APPROVED_CORRECTION_PREPAID_OVERDRAFT'); END;

-- An existing credit purchase's bank-payment / points allocation is a
-- separate immutable financial action. The original purchase may not change
-- its liability / bill date / card while any such allocation is outstanding.
CREATE TRIGGER IF NOT EXISTS trg_future_correction_no_allocated_purchase
 BEFORE INSERT ON family_approved_account_corrections
 WHEN EXISTS(
  SELECT 1 FROM family_card_purchase_applied c
  WHERE c.entry_id=NEW.entry_id AND (
   EXISTS(SELECT 1 FROM family_card_settlement_allocations alloc
    WHERE alloc.purchase_request_id=c.homeflow_request_id)
   OR EXISTS(SELECT 1 FROM family_points_card_offsets offset
    WHERE offset.purchase_request_id=c.homeflow_request_id
     AND offset.amount_jpy>COALESCE((SELECT SUM(ref.restored_jpy)
      FROM family_points_card_offset_refunds ref
      WHERE ref.original_request_id=offset.homeflow_request_id),0))
  )
 ) AND (
  -- Moving the original payment to a different card or day requires signed
  -- independent allocation reversal, never silently reclassify the payment.
  json_extract(NEW.after_json,'$.date') IS NOT json_extract(NEW.before_json,'$.date')
  OR json_extract(NEW.after_json,'$.accountId') IS NOT
     json_extract(NEW.before_json,'$.accountId')
  OR CAST(json_extract(NEW.after_json,'$.amount') AS INTEGER) < (
    COALESCE((SELECT SUM(alloc.amount_jpy) FROM family_card_purchase_applied c
      JOIN family_card_settlement_allocations alloc
        ON alloc.purchase_request_id=c.homeflow_request_id
      WHERE c.entry_id=NEW.entry_id),0)
    +COALESCE((SELECT SUM(offset.amount_jpy-
       COALESCE((SELECT SUM(ref.restored_jpy) FROM family_points_card_offset_refunds ref
        WHERE ref.original_request_id=offset.homeflow_request_id),0))
      FROM family_card_purchase_applied c JOIN family_points_card_offsets offset
       ON offset.purchase_request_id=c.homeflow_request_id
      WHERE c.entry_id=NEW.entry_id),0)
  )
 )
 BEGIN SELECT RAISE(ABORT,'APPROVED_CORRECTION_ALLOCATION_REVERSAL_REQUIRED'); END;
INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(
 'schema-0102-future-approved-correction-serial-guards',
 'Atomic prepaid overdraft and already-allocated card correction guards');
