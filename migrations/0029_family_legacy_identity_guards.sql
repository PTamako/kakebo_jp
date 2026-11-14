-- Stage C forward-only identity integrity. Draft only: never apply to production
-- without separately authorizing and validating 0027/0028 recovery snapshots.
-- Source labels are provenance, not freely mutable identity keys after
-- explicit owner linkage. Money, note, date and category remain editable.
CREATE TRIGGER IF NOT EXISTS trg_legacy_income_expense_identity_update
 BEFORE UPDATE ON entries
 WHEN EXISTS(SELECT 1 FROM family_finance_legacy_entry_links l WHERE l.entry_id=OLD.id)
  AND (NEW.id IS NOT OLD.id OR NEW.type IS NOT OLD.type
       OR NEW.payment_source IS NOT OLD.payment_source
       OR NEW.family_account_id IS NOT OLD.family_account_id
       OR NOT EXISTS(
         SELECT 1 FROM family_finance_legacy_entry_links l
         WHERE l.entry_id=OLD.id AND NEW.payment_source=l.original_source
           AND NEW.family_account_id=l.account_id))
 BEGIN SELECT RAISE(ABORT,'LEGACY_ENTRY_IDENTITY_LOCKED'); END;

CREATE TRIGGER IF NOT EXISTS trg_legacy_transfer_identity_update
 BEFORE UPDATE ON entries
 WHEN EXISTS(SELECT 1 FROM family_finance_legacy_transfer_links l WHERE l.entry_id=OLD.id)
  AND (NEW.id IS NOT OLD.id OR NEW.type IS NOT OLD.type
       OR NEW.payment_source IS NOT OLD.payment_source
       OR NEW.transfer_target IS NOT OLD.transfer_target
       OR NEW.family_account_id IS NOT OLD.family_account_id
       OR NEW.family_transfer_target_account_id IS NOT OLD.family_transfer_target_account_id
       OR NOT EXISTS(
         SELECT 1 FROM family_finance_legacy_transfer_links l
         WHERE l.entry_id=OLD.id AND NEW.type='transfer'
          AND NEW.payment_source=l.source_name AND NEW.transfer_target=l.target_name
          AND NEW.family_account_id=l.source_account_id
          AND NEW.family_transfer_target_account_id=l.target_account_id))
 BEGIN SELECT RAISE(ABORT,'LEGACY_TRANSFER_IDENTITY_LOCKED'); END;

-- A deleted/recycled legacy row can be restored with the exact same identity
-- only. Forbid an accidentally reused entry ID from silently inheriting a
-- receipt that belongs to an older row.
CREATE TRIGGER IF NOT EXISTS trg_legacy_income_expense_identity_reinsert
 BEFORE INSERT ON entries
 WHEN EXISTS(SELECT 1 FROM family_finance_legacy_entry_links l WHERE l.entry_id=NEW.id)
  AND NOT EXISTS(
    SELECT 1 FROM family_finance_legacy_entry_links l
    WHERE l.entry_id=NEW.id AND NEW.type IN ('income','expense')
     AND NEW.payment_source=l.original_source AND NEW.family_account_id=l.account_id)
 BEGIN SELECT RAISE(ABORT,'LEGACY_ENTRY_RESTORE_IDENTITY_MISMATCH'); END;
CREATE TRIGGER IF NOT EXISTS trg_legacy_transfer_identity_reinsert
 BEFORE INSERT ON entries
 WHEN EXISTS(SELECT 1 FROM family_finance_legacy_transfer_links l WHERE l.entry_id=NEW.id)
  AND NOT EXISTS(
    SELECT 1 FROM family_finance_legacy_transfer_links l
    WHERE l.entry_id=NEW.id AND NEW.type='transfer'
     AND NEW.payment_source=l.source_name AND NEW.transfer_target=l.target_name
     AND NEW.family_account_id=l.source_account_id
     AND NEW.family_transfer_target_account_id=l.target_account_id)
 BEGIN SELECT RAISE(ABORT,'LEGACY_TRANSFER_RESTORE_IDENTITY_MISMATCH'); END;

-- Never rename or remove a payment-source key that was claimed by the
-- original owner. Explicit account DISPLAY labels may still be renamed.
CREATE TRIGGER IF NOT EXISTS trg_legacy_claimed_source_name_update
 BEFORE UPDATE OF name ON payment_sources
 WHEN NEW.name IS NOT OLD.name AND EXISTS(
  SELECT 1 FROM family_financial_accounts a
  WHERE a.origin='legacy' AND a.legacy_source_name=OLD.name)
 BEGIN SELECT RAISE(ABORT,'LEGACY_SOURCE_NAME_LOCKED'); END;
CREATE TRIGGER IF NOT EXISTS trg_legacy_claimed_source_name_delete
 BEFORE DELETE ON payment_sources
 WHEN EXISTS(
  SELECT 1 FROM family_financial_accounts a
  WHERE a.origin='legacy' AND a.legacy_source_name=OLD.name)
 BEGIN SELECT RAISE(ABORT,'LEGACY_SOURCE_NAME_LOCKED'); END;
INSERT OR IGNORE INTO schema_migrations(version,description)
 VALUES('schema-0029-family-legacy-identity-guards',
 'Protect provenance of adopted legacy transfer and expense IDs across edits and restores');
