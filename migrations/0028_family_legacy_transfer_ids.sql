-- Stage C (UNEXECUTED): a transfer has TWO independent account identities.
-- Append-only audit and ADDITIVE target-ID column; never guess ownership
-- from names, recalculate money or rewrite any existing old transaction.
-- Production migration and write feature require separate release approval.
ALTER TABLE entries ADD COLUMN family_transfer_target_account_id TEXT
 REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_entries_family_transfer_target
 ON entries(family_transfer_target_account_id,date DESC,id DESC)
 WHERE family_transfer_target_account_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS family_finance_legacy_transfer_links (
 entry_id INTEGER PRIMARY KEY NOT NULL CHECK(entry_id>0),
 household_id TEXT NOT NULL,
 actor_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id),
 source_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id),
 target_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id),
 source_name TEXT NOT NULL,
 target_name TEXT NOT NULL,
 source_digest TEXT NOT NULL CHECK(length(source_digest)=64),
 linked_at INTEGER NOT NULL,
 CHECK(source_account_id<>target_account_id),
 CHECK(source_name<>target_name)
);
CREATE INDEX IF NOT EXISTS idx_family_legacy_transfer_links_owner
 ON family_finance_legacy_transfer_links(household_id,actor_user_id,linked_at DESC);
CREATE TRIGGER IF NOT EXISTS trg_family_legacy_transfer_links_entry_match
 BEFORE INSERT ON family_finance_legacy_transfer_links
 WHEN NOT EXISTS(
  SELECT 1 FROM entries e
  JOIN family_financial_accounts a ON a.account_id=NEW.source_account_id
  JOIN family_financial_accounts b ON b.account_id=NEW.target_account_id
  JOIN homeflow_identity_links h ON h.user_id=NEW.actor_user_id
  WHERE e.id=NEW.entry_id AND e.type='transfer'
   AND e.family_account_id=NEW.source_account_id
   AND e.family_transfer_target_account_id=NEW.target_account_id
   AND e.payment_source=NEW.source_name AND e.transfer_target=NEW.target_name
   AND a.origin='legacy' AND b.origin='legacy'
   AND a.legacy_source_name=NEW.source_name
   AND b.legacy_source_name=NEW.target_name
   AND a.owner_user_id=NEW.actor_user_id AND b.owner_user_id=NEW.actor_user_id
   AND a.household_id=NEW.household_id AND b.household_id=NEW.household_id
   AND h.household_id=NEW.household_id AND h.role='owner' AND h.state='active'
 )
 BEGIN SELECT RAISE(ABORT,'LEGACY_TRANSFER_TARGET_MISMATCH'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_legacy_transfer_links_immutable_update
 BEFORE UPDATE ON family_finance_legacy_transfer_links
 BEGIN SELECT RAISE(ABORT,'LEGACY_TRANSFER_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_legacy_transfer_links_immutable_delete
 BEFORE DELETE ON family_finance_legacy_transfer_links
 BEGIN SELECT RAISE(ABORT,'LEGACY_TRANSFER_AUDIT_IMMUTABLE'); END;
INSERT OR IGNORE INTO schema_migrations(version,description)
 VALUES('schema-0028-family-legacy-transfer-ids',
 'Additive independent source/target account IDs and immutable original-owner transfer link receipts, no legacy edits');
