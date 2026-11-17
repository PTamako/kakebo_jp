-- 0103: reconcile journal and top-up correction guards with approved
-- immutable account effects. All three balance writers use the same delta
-- composition; no historical original receipt or journal is rewritten.
-- Requires 0075 and 0100-0102, applied before enabling the executor.
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
     +COALESCE((SELECT SUM(e.delta_jpy) FROM family_approved_account_effects e
       WHERE e.account_id=NEW.prepaid_account_id AND e.account_kind='prepaid'
        AND e.household_id=NEW.household_id),0)
     +NEW.delta_jpy AND NEW.balance_after_jpy>=0
 ) BEGIN SELECT RAISE(ABORT,'PREPAID_OVERDRAFT_OR_CONCURRENT_BALANCE'); END;

-- 0075's original top-up correction trigger does not know about future
-- approved expense effects. Reject a source-wallet overdraft caused by the
-- new correction at the moment it is inserted, even during concurrent writes.
CREATE TRIGGER IF NOT EXISTS trg_future_topup_correction_account_effects
 BEFORE INSERT ON family_member_prepaid_topup_corrections
 WHEN (
   COALESCE((SELECT SUM(j.delta_jpy) FROM family_prepaid_balance_journal j
     WHERE j.prepaid_account_id=NEW.before_account_id AND j.household_id=NEW.household_id),0)
  +COALESCE((SELECT SUM(t.amount_jpy) FROM family_member_prepaid_topups t
     WHERE t.prepaid_account_id=NEW.before_account_id AND t.household_id=NEW.household_id),0)
  +COALESCE((SELECT SUM((CASE WHEN k.after_account_id=NEW.before_account_id THEN k.after_amount_jpy ELSE 0 END)
     -(CASE WHEN k.before_account_id=NEW.before_account_id THEN k.before_amount_jpy ELSE 0 END))
     FROM family_member_prepaid_topup_corrections k
     WHERE k.household_id=NEW.household_id AND
      (k.before_account_id=NEW.before_account_id OR k.after_account_id=NEW.before_account_id)),0)
  +COALESCE((SELECT SUM(c.amount_jpy) FROM family_points_prepaid_credits c
     WHERE c.prepaid_account_id=NEW.before_account_id AND c.household_id=NEW.household_id),0)
  -COALESCE((SELECT SUM(r.debited_prepaid_jpy) FROM family_points_prepaid_refunds r
     WHERE r.prepaid_account_id=NEW.before_account_id AND r.household_id=NEW.household_id),0)
  +COALESCE((SELECT SUM(e.delta_jpy) FROM family_approved_account_effects e
     WHERE e.account_id=NEW.before_account_id AND e.account_kind='prepaid'
      AND e.household_id=NEW.household_id),0)
  -NEW.before_amount_jpy
  +CASE WHEN NEW.before_account_id=NEW.after_account_id THEN NEW.after_amount_jpy ELSE 0 END
  NOT BETWEEN 0 AND 100000000
 )
 BEGIN SELECT RAISE(ABORT,'FUTURE_TOPUP_CORRECTION_ACCOUNT_OVERDRAFT'); END;
INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(
 'schema-0103-future-prepaid-writer-serial-guards',
 'Carry approved expense deltas into prepaid spend journal and top-up correction atomic balance guards');
