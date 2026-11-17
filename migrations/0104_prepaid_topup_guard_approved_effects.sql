-- 0104 closes the remaining stale-balance path in the original 0075
-- personal top-up correction guard. The historical authorization, CAS,
-- immutability and owner checks remain verbatim; only approved expense delta
-- is added to the verified source wallet balance before any new correction.
-- Requires 0100-0103.
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
     -NEW.before_amount_jpy
     +(CASE WHEN NEW.before_account_id=NEW.after_account_id THEN NEW.after_amount_jpy ELSE 0 END))>=0
 ) BEGIN SELECT RAISE(ABORT,'PERSONAL_TOPUP_CORRECTION_STALE_OR_OVERDRAW'); END;

INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(
 'schema-0104-prepaid-topup-guard-approved-effects',
 'Count approved prepaid spending corrections in source-wallet CAS/overdraft guard');
