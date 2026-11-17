-- 0105 Repair the production-only 0032 card immutability gate. It previously
-- aborted every approved card correction despite the signed 0100-0104 journal.
-- Never weaken the original purchase receipt, allocation or its foreign keys.
-- Only a SAME-BATCH, signed HomeFlow owner approval with immutable before/after
-- accounting evidence may update the physical household expense row.
DROP TRIGGER IF EXISTS trg_family_card_purchase_entry_no_update;
CREATE TRIGGER trg_family_card_purchase_entry_no_update
 BEFORE UPDATE ON entries
 WHEN EXISTS(SELECT 1 FROM family_card_purchase_applied p WHERE p.entry_id=OLD.id)
 AND NOT EXISTS (
  SELECT 1 FROM family_approved_account_corrections correction
  JOIN family_shared_entry_registry registry ON registry.entry_id=correction.entry_id
  JOIN family_shared_entry_write_context context ON context.resource_id=registry.resource_id
  JOIN family_card_purchase_applied original ON original.entry_id=correction.entry_id
  WHERE correction.entry_id=OLD.id
   AND original.household_id=correction.household_id
   AND correction.spender_user_id=original.requester_user_id
   AND OLD.client_request_id='hfcard:'||original.homeflow_request_id
   AND NEW.client_request_id=OLD.client_request_id
   AND OLD.type='expense' AND NEW.type='expense'
   AND NEW.family_transfer_target_account_id IS NULL
   AND registry.version=correction.version_before
   AND correction.version_after=registry.version+1
   AND context.entry_id=OLD.id AND context.expected_version=registry.version
   AND context.action IN ('update','delete','restore')
   AND context.actor_user_id=correction.approver_user_id
   AND json_extract(correction.before_json,'$.amount')=OLD.amount
   AND json_extract(correction.before_json,'$.date')=OLD.date
   AND json_extract(correction.before_json,'$.accountId') IS OLD.family_account_id
   AND json_extract(correction.after_json,'$.amount')=NEW.amount
   AND json_extract(correction.after_json,'$.date')=NEW.date
   AND json_extract(correction.after_json,'$.accountId') IS NEW.family_account_id
   AND NEW.payment_source=CASE WHEN NEW.family_account_id IS NULL THEN ''
    ELSE (SELECT CASE WHEN a.account_kind='credit_card' THEN 'cc:'
                      WHEN a.account_kind='prepaid' THEN 'prepaid:'
                      ELSE 'invalid:' END||a.account_id
          FROM family_financial_accounts a
          WHERE a.account_id=NEW.family_account_id AND a.household_id=correction.household_id
            AND a.owner_user_id=correction.spender_user_id)
    END
 )
 BEGIN SELECT RAISE(ABORT,'CARD_PURCHASE_ENTRY_IMMUTABLE'); END;
INSERT OR IGNORE INTO schema_migrations(version,description) VALUES (
 'schema-0105-future-card-correction-entry-guard',
 'Permit only signed immutable owner-approved credit purchase edits in real production D1');
