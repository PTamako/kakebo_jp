-- DRAFT 0057: atomic claim of independently SHA-verified 0056 R2 copy.
-- Append-only compatibility extension to original owner adoption 0055.
-- NEVER delete old R2 object automatically; source remains tombstoned/private.
DROP TRIGGER IF EXISTS trg_legacy_shared_adoptions_owner;
CREATE TRIGGER trg_legacy_shared_adoptions_owner BEFORE INSERT
ON family_legacy_shared_adoptions
WHEN NOT EXISTS (
 SELECT 1 FROM homeflow_identity_links actor
 JOIN family_finance_legacy_entry_links l ON l.actor_user_id=actor.user_id
 JOIN family_financial_accounts a ON a.account_id=l.account_id
 JOIN entries e ON e.id=l.entry_id
 WHERE l.entry_id=NEW.entry_id AND l.household_id=NEW.household_id
 AND l.actor_user_id=NEW.original_owner_user_id
 AND l.account_id=NEW.account_id AND l.source_digest=NEW.original_link_digest
 AND actor.household_id=NEW.household_id AND actor.role='owner' AND actor.state='active'
 AND a.owner_user_id=actor.user_id AND a.household_id=NEW.household_id
 AND a.is_archived=0 AND e.family_account_id=a.account_id
 AND e.payment_source=l.original_source
 AND e.client_request_id IS NEW.original_client_request_id
 AND e.type IN('income','expense') AND e.amount>0
 AND e.family_transfer_target_account_id IS NULL
 AND (e.client_request_id IS NULL OR
   (e.client_request_id NOT LIKE 'hfshare:%'
   AND e.client_request_id NOT LIKE 'hfrecurring:%'
   AND e.client_request_id NOT LIKE 'hfbanktransfer:%'))
 AND (NOT EXISTS(SELECT 1 FROM receipt_r2_state rs WHERE rs.entry_id=e.id)  OR EXISTS(SELECT 1 FROM family_legacy_shared_receipt_copies c  JOIN receipt_r2_state rs ON rs.entry_id=c.entry_id  WHERE c.entry_id=e.id AND c.resource_id=NEW.resource_id  AND c.account_id=NEW.account_id AND c.owner_user_id=NEW.original_owner_user_id  AND c.household_id=NEW.household_id  AND c.source_snapshot_sha256=NEW.source_snapshot_sha256  AND c.state='verified' AND rs.deleted=0  AND (rs.size_bytes IS NULL OR rs.size_bytes=c.size_bytes)))
 AND NOT EXISTS(SELECT 1 FROM family_shared_entry_registry r WHERE r.entry_id=e.id)
) BEGIN SELECT RAISE(ABORT,'LEGACY_SHARED_ADOPT_OWNER_OR_SOURCE_INVALID'); END;


CREATE TABLE IF NOT EXISTS family_legacy_shared_receipt_claims(
 entry_id INTEGER PRIMARY KEY REFERENCES family_legacy_shared_receipt_copies(entry_id) ON DELETE RESTRICT,
 resource_id TEXT NOT NULL UNIQUE REFERENCES family_shared_entry_registry(resource_id) ON DELETE RESTRICT,
 object_id TEXT NOT NULL UNIQUE REFERENCES family_shared_entry_attachments(object_id) ON DELETE RESTRICT,
 household_id TEXT NOT NULL,
 original_owner_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id),
 claimed_at INTEGER NOT NULL CHECK(claimed_at>0)
);
CREATE TRIGGER IF NOT EXISTS trg_legacy_shared_receipt_claim_guard BEFORE INSERT
ON family_legacy_shared_receipt_claims
WHEN NOT EXISTS(
 SELECT 1 FROM family_legacy_shared_receipt_copies c
 JOIN family_shared_entry_registry r ON r.resource_id=c.resource_id
 JOIN family_shared_entry_attachments a ON a.resource_id=r.resource_id
 JOIN family_legacy_shared_adoptions adopt ON adopt.resource_id=r.resource_id
 JOIN receipt_r2_state legacy ON legacy.entry_id=c.entry_id
 JOIN homeflow_identity_links owner ON owner.user_id=c.owner_user_id
 WHERE c.entry_id=NEW.entry_id AND c.resource_id=NEW.resource_id
 AND c.object_id=NEW.object_id AND c.household_id=NEW.household_id
 AND c.owner_user_id=NEW.original_owner_user_id AND c.state='verified'
 AND owner.household_id=NEW.household_id AND owner.role='owner' AND owner.state='active'
 AND r.entry_id=NEW.entry_id AND r.household_id=NEW.household_id
 AND r.creator_user_id=NEW.original_owner_user_id AND r.state='active'
 AND adopt.entry_id=NEW.entry_id AND adopt.source_snapshot_sha256=c.source_snapshot_sha256
 AND a.object_id=NEW.object_id AND a.state='ready' AND a.sha256=c.byte_sha256
 AND a.size_bytes=c.size_bytes AND a.content_type=c.content_type
 AND legacy.deleted=1
) BEGIN SELECT RAISE(ABORT,'LEGACY_RECEIPT_COPY_CLAIM_MISSING_COUNTERPART'); END;
CREATE TRIGGER IF NOT EXISTS trg_legacy_shared_receipt_claim_immutable_update
BEFORE UPDATE ON family_legacy_shared_receipt_claims
BEGIN SELECT RAISE(ABORT,'LEGACY_RECEIPT_CLAIM_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_legacy_shared_receipt_claim_immutable_delete
BEFORE DELETE ON family_legacy_shared_receipt_claims
BEGIN SELECT RAISE(ABORT,'LEGACY_RECEIPT_CLAIM_IMMUTABLE'); END;
-- The old D1 tombstone cannot be revived by any old cache or obsolete writer.
CREATE TRIGGER IF NOT EXISTS trg_legacy_receipt_claim_tombstone_guard_update
BEFORE UPDATE ON receipt_r2_state
WHEN EXISTS(SELECT 1 FROM family_legacy_shared_receipt_claims c WHERE c.entry_id=OLD.entry_id)
AND NEW.deleted<>1
BEGIN SELECT RAISE(ABORT,'LEGACY_RECEIPT_CLAIM_TOMBSTONE_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_legacy_receipt_claim_tombstone_guard_delete
BEFORE DELETE ON receipt_r2_state
WHEN EXISTS(SELECT 1 FROM family_legacy_shared_receipt_claims c WHERE c.entry_id=OLD.entry_id)
BEGIN SELECT RAISE(ABORT,'LEGACY_RECEIPT_CLAIM_TOMBSTONE_IMMUTABLE'); END;
INSERT OR IGNORE INTO schema_migrations(version,description)
VALUES('schema-0057-legacy-shared-receipt-claim',
'UNDEPLOYED atomic source tombstone and verified shared object reference; old source retained');
