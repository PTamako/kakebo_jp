-- 0107: all prepaid writers share member- and owner-approved financial effects.
-- Every update is append-only; guards run at the serialized SQLite write.
DROP TRIGGER IF EXISTS trg_future_prepaid_effect_nonnegative;
CREATE TRIGGER trg_future_prepaid_effect_nonnegative
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
  +COALESCE((SELECT SUM(o.delta_jpy) FROM family_owner_account_effects o
   WHERE o.account_id=NEW.account_id AND o.account_kind='prepaid'
    AND o.household_id=NEW.household_id),0)
  +NEW.delta_jpy NOT BETWEEN 0 AND 100000000
 )
 BEGIN SELECT RAISE(ABORT,'APPROVED_CORRECTION_PREPAID_OVERDRAFT'); END;



DROP TRIGGER IF EXISTS trg_owner_prepaid_effect_nonnegative;
CREATE TRIGGER trg_owner_prepaid_effect_nonnegative
 BEFORE INSERT ON family_owner_account_effects
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
  +COALESCE((SELECT SUM(o.delta_jpy) FROM family_owner_account_effects o
   WHERE o.account_id=NEW.account_id AND o.account_kind='prepaid'
    AND o.household_id=NEW.household_id),0)
  +NEW.delta_jpy NOT BETWEEN 0 AND 100000000
 )
 BEGIN SELECT RAISE(ABORT,'OWNER_CORRECTION_PREPAID_OVERDRAFT'); END;



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
     +COALESCE((SELECT SUM(o.delta_jpy) FROM family_owner_account_effects o
      WHERE o.account_id=NEW.prepaid_account_id AND o.account_kind='prepaid'
       AND o.household_id=NEW.household_id),0)
     +NEW.delta_jpy AND NEW.balance_after_jpy>=0
 ) BEGIN SELECT RAISE(ABORT,'PREPAID_OVERDRAFT_OR_CONCURRENT_BALANCE'); END;



DROP TRIGGER IF EXISTS trg_future_topup_correction_account_effects;
CREATE TRIGGER trg_future_topup_correction_account_effects
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
  +COALESCE((SELECT SUM(o.delta_jpy) FROM family_owner_account_effects o
   WHERE o.account_id=NEW.before_account_id AND o.account_kind='prepaid'
    AND o.household_id=NEW.household_id),0)
  -NEW.before_amount_jpy
  +CASE WHEN NEW.before_account_id=NEW.after_account_id THEN NEW.after_amount_jpy ELSE 0 END
  NOT BETWEEN 0 AND 100000000
 )
 BEGIN SELECT RAISE(ABORT,'FUTURE_TOPUP_CORRECTION_ACCOUNT_OVERDRAFT'); END;


DROP TRIGGER IF EXISTS trg_member_topup_correction_guard;
CREATE TRIGGER trg_member_topup_correction_guard
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
     +COALESCE((SELECT SUM(e.delta_jpy) FROM family_approved_account_effects e
        WHERE e.account_id=NEW.before_account_id AND e.account_kind='prepaid'
          AND e.household_id=NEW.household_id),0)
     +COALESCE((SELECT SUM(o.delta_jpy) FROM family_owner_account_effects o
      WHERE o.account_id=NEW.before_account_id AND o.account_kind='prepaid'
       AND o.household_id=NEW.household_id),0)
     -NEW.before_amount_jpy
     +(CASE WHEN NEW.before_account_id=NEW.after_account_id THEN NEW.after_amount_jpy ELSE 0 END))>=0
 ) BEGIN SELECT RAISE(ABORT,'PERSONAL_TOPUP_CORRECTION_STALE_OR_OVERDRAW'); END;



INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(
 'schema-0107-owner-prepaid-all-writers',
 'Include signed owner ledger expense deltas in card/prepaid balances, top-up CAS and atomic spend guards');
