-- 0039 (Draft only): audited, non-minting historical points provenance.
-- Explicit original owner proof comes from the already-immutable 0027 link.
-- A legacy point entry can be attached to ONE new stable points account once.
-- No points journal, legacy entry UPDATE, financial transaction or backfill.
CREATE TABLE IF NOT EXISTS family_points_legacy_provenance (
 legacy_entry_id INTEGER PRIMARY KEY NOT NULL REFERENCES family_points_legacy_links(legacy_entry_id) ON DELETE RESTRICT,
 household_id TEXT NOT NULL,
 owner_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 source_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 points_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 source_digest TEXT NOT NULL CHECK(length(source_digest)=64),
 original_amount_jpy INTEGER NOT NULL CHECK(original_amount_jpy BETWEEN 0 AND 1000000000),
 original_type TEXT NOT NULL CHECK(original_type IN ('income','expense')),
 legacy_kind TEXT NOT NULL CHECK(legacy_kind IN ('earn','spend','topup','card_offset','sbi_point','other')),
 reviewed_at INTEGER NOT NULL CHECK(reviewed_at>0)
);
CREATE INDEX IF NOT EXISTS idx_points_legacy_provenance_account
 ON family_points_legacy_provenance(household_id,owner_user_id,points_account_id);
CREATE TRIGGER IF NOT EXISTS trg_points_legacy_provenance_guard
 BEFORE INSERT ON family_points_legacy_provenance
 WHEN NOT EXISTS(
  SELECT 1 FROM family_points_legacy_links points
  JOIN family_finance_legacy_entry_links original
   ON original.entry_id=points.legacy_entry_id
  JOIN entries e ON e.id=points.legacy_entry_id
  JOIN family_financial_accounts legacy ON legacy.account_id=NEW.source_account_id
  JOIN family_financial_accounts target ON target.account_id=points.points_account_id
  JOIN homeflow_identity_links current ON current.user_id=NEW.owner_user_id
  WHERE points.legacy_entry_id=NEW.legacy_entry_id
    AND points.household_id=NEW.household_id
    AND points.owner_user_id=NEW.owner_user_id
    AND points.points_account_id=NEW.points_account_id
    AND points.legacy_kind=NEW.legacy_kind
    AND points.reviewed_at=NEW.reviewed_at
    AND points.reviewed_by_user_id=NEW.owner_user_id
    AND original.household_id=NEW.household_id
    AND original.actor_user_id=NEW.owner_user_id
    AND original.account_id=NEW.source_account_id
    AND legacy.account_id=e.family_account_id
    AND legacy.origin='legacy' AND legacy.account_kind='points'
    AND legacy.household_id=NEW.household_id AND legacy.owner_user_id=NEW.owner_user_id
    AND target.origin='member_created' AND target.account_kind='points'
    AND target.opening_balance=0 AND target.is_archived=0
    AND target.household_id=NEW.household_id AND target.owner_user_id=NEW.owner_user_id
    AND current.role='owner' AND current.state='active'
    AND current.household_id=NEW.household_id
    AND e.type=NEW.original_type AND e.amount=NEW.original_amount_jpy
    AND e.type IN ('income','expense')
    AND NOT EXISTS (SELECT 1 FROM family_points_journal j
     WHERE j.linked_entry_id=NEW.legacy_entry_id OR j.legacy_entry_id=NEW.legacy_entry_id)
 )
 BEGIN SELECT RAISE(ABORT,'POINTS_LEGACY_PROVENANCE_OR_OWNER_INVALID'); END;
CREATE TRIGGER IF NOT EXISTS trg_points_legacy_provenance_no_update
 BEFORE UPDATE ON family_points_legacy_provenance
 BEGIN SELECT RAISE(ABORT,'POINTS_LEGACY_PROVENANCE_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_points_legacy_provenance_no_delete
 BEFORE DELETE ON family_points_legacy_provenance
 BEGIN SELECT RAISE(ABORT,'POINTS_LEGACY_PROVENANCE_IMMUTABLE'); END;
-- Do not let an old source row drift after a permanent provenance claim.
-- Future corrections require a new explicit immutable adjusting record.
CREATE TRIGGER IF NOT EXISTS trg_points_legacy_linked_entry_no_update
 BEFORE UPDATE ON entries
 WHEN EXISTS(SELECT 1 FROM family_points_legacy_provenance p
  WHERE p.legacy_entry_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'POINTS_LEGACY_ORIGINAL_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_points_legacy_linked_entry_no_delete
 BEFORE DELETE ON entries
 WHEN EXISTS(SELECT 1 FROM family_points_legacy_provenance p
  WHERE p.legacy_entry_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'POINTS_LEGACY_ORIGINAL_IMMUTABLE'); END;
INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(
 'schema-0039-points-legacy-provenance',
 'Unexecuted Draft one-time verified owner historical points link, snapshot digest, zero units minted');
