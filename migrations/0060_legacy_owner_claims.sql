-- 2026-11-16: original owner's explicit request to attribute ALL existing
-- legacy financial data to the verified HomeFlow household owner.
-- Additive provenance only: NEVER rewrite entries, card balances, amounts,
-- transfers, or legacy payment source keys. Family ledger stays shared.
-- A claim identifies the OWNER, not the historical human who entered the row.
-- Account-specific transaction links are a separate, evidence-based step.
CREATE TABLE IF NOT EXISTS family_legacy_owner_claims (
 record_scope TEXT NOT NULL CHECK(record_scope IN ('ledger','trash_entry','payment_source')),
 record_key TEXT NOT NULL CHECK(length(record_key) BETWEEN 1 AND 240),
 household_id TEXT NOT NULL,
 owner_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 source_stamp TEXT NOT NULL,
 confirmation_source TEXT NOT NULL DEFAULT 'explicit_original_owner_instruction'
   CHECK(confirmation_source='explicit_original_owner_instruction'),
 claimed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(record_scope,record_key)
);
CREATE INDEX IF NOT EXISTS idx_family_legacy_owner_claims_owner
 ON family_legacy_owner_claims(household_id,owner_user_id,record_scope);
CREATE TRIGGER IF NOT EXISTS trg_family_legacy_owner_claims_verified_insert
 BEFORE INSERT ON family_legacy_owner_claims
 WHEN NOT EXISTS(
   SELECT 1 FROM homeflow_identity_links l
   WHERE l.user_id=NEW.owner_user_id AND l.household_id=NEW.household_id
     AND l.role='owner' AND l.state='active'
 ) OR (
   NEW.record_scope='ledger' AND NOT EXISTS(
     SELECT 1 FROM entries e WHERE CAST(e.id AS TEXT)=NEW.record_key
       AND CAST(e.created_at AS TEXT)=NEW.source_stamp
   )
 ) OR (
   NEW.record_scope='trash_entry' AND NOT EXISTS(
     SELECT 1 FROM trash_items t WHERE t.item_type='entry'
       AND t.item_id=NEW.record_key AND t.deleted_at=NEW.source_stamp
   )
 ) OR (
   NEW.record_scope='payment_source' AND NOT EXISTS(
     SELECT 1 FROM payment_sources p WHERE p.name=NEW.record_key
       AND p.name=NEW.source_stamp
   )
 )
 BEGIN SELECT RAISE(ABORT,'ORIGINAL_OWNER_OR_SOURCE_PROOF_REQUIRED'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_legacy_owner_claims_immutable_update
 BEFORE UPDATE ON family_legacy_owner_claims
 BEGIN SELECT RAISE(ABORT,'LEGACY_OWNER_CLAIM_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_legacy_owner_claims_immutable_delete
 BEFORE DELETE ON family_legacy_owner_claims
 BEGIN SELECT RAISE(ABORT,'LEGACY_OWNER_CLAIM_IMMUTABLE'); END;

-- The singleton owner check is intentional. No nickname-based ownership guesses.
-- Run only after checking the production bookmark and entry counts.
INSERT INTO family_legacy_owner_claims
 (record_scope,record_key,household_id,owner_user_id,source_stamp)
 SELECT 'ledger',CAST(e.id AS TEXT),l.household_id,l.user_id,
        CAST(e.created_at AS TEXT)
 FROM entries e CROSS JOIN homeflow_identity_links l
 WHERE l.role='owner' AND l.state='active'
   AND (SELECT COUNT(*) FROM homeflow_identity_links
        WHERE role='owner' AND state='active')=1
   AND e.created_at IS NOT NULL
   AND NOT EXISTS(
    SELECT 1 FROM family_legacy_owner_claims c
    WHERE c.record_scope='ledger' AND c.record_key=CAST(e.id AS TEXT)
   );
INSERT INTO family_legacy_owner_claims
 (record_scope,record_key,household_id,owner_user_id,source_stamp)
 SELECT 'trash_entry',t.item_id,l.household_id,l.user_id,t.deleted_at
 FROM trash_items t CROSS JOIN homeflow_identity_links l
 WHERE t.item_type='entry' AND l.role='owner' AND l.state='active'
   AND (SELECT COUNT(*) FROM homeflow_identity_links
        WHERE role='owner' AND state='active')=1
   AND NOT EXISTS(
    SELECT 1 FROM family_legacy_owner_claims c
    WHERE c.record_scope='trash_entry' AND c.record_key=t.item_id
   );
INSERT INTO family_legacy_owner_claims
 (record_scope,record_key,household_id,owner_user_id,source_stamp)
 SELECT 'payment_source',p.name,l.household_id,l.user_id,p.name
 FROM payment_sources p CROSS JOIN homeflow_identity_links l
 WHERE l.role='owner' AND l.state='active'
   AND (SELECT COUNT(*) FROM homeflow_identity_links
        WHERE role='owner' AND state='active')=1
   AND NOT EXISTS(
    SELECT 1 FROM family_legacy_owner_claims c
    WHERE c.record_scope='payment_source' AND c.record_key=p.name
   );
INSERT OR IGNORE INTO schema_migrations(version,description)
 VALUES('schema-0060-original-owner-claims',
  'Immutable verified original-owner provenance for preexisting entries, deleted entries and payment sources');
