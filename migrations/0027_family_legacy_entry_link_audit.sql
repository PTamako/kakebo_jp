-- Stage C: immutable audit of explicit single-entry legacy stable-ID links.
-- NEVER run in production without separate release approval; does not alter
-- any preexisting historical entry or infer owners by shared display names.
-- The actual write route is additionally opt-in, disabled by default.
CREATE TABLE IF NOT EXISTS family_finance_legacy_entry_links (
 entry_id INTEGER PRIMARY KEY NOT NULL CHECK(entry_id>0),
 household_id TEXT NOT NULL,
 actor_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id),
 account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id),
 original_source TEXT NOT NULL,
 source_digest TEXT NOT NULL CHECK(length(source_digest)=64),
 linked_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_family_legacy_entry_links_owner
 ON family_finance_legacy_entry_links(household_id,actor_user_id,linked_at DESC);
CREATE TRIGGER IF NOT EXISTS trg_family_legacy_entry_links_immutable_update
 BEFORE UPDATE ON family_finance_legacy_entry_links
 BEGIN SELECT RAISE(ABORT,'LEGACY_ENTRY_LINK_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_legacy_entry_links_immutable_delete
 BEFORE DELETE ON family_finance_legacy_entry_links
 BEGIN SELECT RAISE(ABORT,'LEGACY_ENTRY_LINK_AUDIT_IMMUTABLE'); END;
INSERT OR IGNORE INTO schema_migrations(version,description)
 VALUES('schema-0027-family-legacy-entry-links',
 'Immutable explicit original-owner payment source to account ID link receipts, no legacy edits');
