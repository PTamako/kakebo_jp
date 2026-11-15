-- UNDEPLOYED 0059: repair a missing private shared R2 copy using the retained
-- original. No source deletion, no cash/ledger changes, no implicit purge.
-- Resumable, actor-bound intent is durable BEFORE conditional R2 PUT. A
-- missing target after completion requires a fresh idempotency ID and review.
CREATE TABLE IF NOT EXISTS family_legacy_shared_receipt_repairs(
 request_id TEXT PRIMARY KEY CHECK(length(request_id)=32),
 entry_id INTEGER NOT NULL REFERENCES family_legacy_shared_receipt_copies(entry_id) ON DELETE RESTRICT,
 resource_id TEXT NOT NULL REFERENCES family_shared_entry_registry(resource_id) ON DELETE RESTRICT,
 object_id TEXT NOT NULL REFERENCES family_shared_entry_attachments(object_id) ON DELETE RESTRICT,
 household_id TEXT NOT NULL,
 owner_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id),
 byte_sha256 TEXT NOT NULL CHECK(length(byte_sha256)=64),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN('pending','completed')),
 prepared_at INTEGER NOT NULL CHECK(prepared_at>0),
 completed_at INTEGER,
 CHECK((status='pending' AND completed_at IS NULL) OR
       (status='completed' AND completed_at>=prepared_at))
);
CREATE INDEX IF NOT EXISTS idx_legacy_receipt_repairs_entry
 ON family_legacy_shared_receipt_repairs(entry_id,prepared_at);
CREATE TRIGGER IF NOT EXISTS trg_legacy_receipt_repair_owner BEFORE INSERT
ON family_legacy_shared_receipt_repairs
WHEN NEW.status<>'pending' OR NEW.completed_at IS NOT NULL
 OR NOT EXISTS(
  SELECT 1 FROM family_legacy_shared_receipt_copies c
  JOIN family_legacy_shared_receipt_claims claim ON claim.entry_id=c.entry_id
  JOIN family_shared_entry_registry reg ON reg.resource_id=c.resource_id
  JOIN family_shared_entry_attachments a ON a.object_id=c.object_id
  JOIN family_legacy_shared_adoptions adopted ON adopted.entry_id=c.entry_id
  JOIN homeflow_identity_links owner ON owner.user_id=c.owner_user_id
  JOIN family_financial_accounts account ON account.account_id=c.account_id
  JOIN receipt_r2_state old ON old.entry_id=c.entry_id
  WHERE c.entry_id=NEW.entry_id AND c.resource_id=NEW.resource_id
   AND c.object_id=NEW.object_id AND c.household_id=NEW.household_id
   AND c.owner_user_id=NEW.owner_user_id AND c.byte_sha256=NEW.byte_sha256
   AND c.state='verified' AND claim.resource_id=c.resource_id
   AND claim.object_id=c.object_id AND claim.household_id=c.household_id
   AND reg.entry_id=c.entry_id AND reg.household_id=c.household_id
   AND reg.state IN('active','deleted')
   AND a.resource_id=c.resource_id AND a.state='ready'
   AND a.sha256=c.byte_sha256 AND a.size_bytes=c.size_bytes
   AND adopted.resource_id=c.resource_id AND adopted.original_owner_user_id=c.owner_user_id
   AND owner.household_id=c.household_id AND owner.role='owner' AND owner.state='active'
   AND account.owner_user_id=c.owner_user_id AND account.household_id=c.household_id
   AND account.is_archived=0 AND old.deleted=1)
BEGIN SELECT RAISE(ABORT,'LEGACY_RECEIPT_REPAIR_PROVENANCE_INVALID'); END;
CREATE TRIGGER IF NOT EXISTS trg_legacy_receipt_repair_no_mutate
BEFORE UPDATE ON family_legacy_shared_receipt_repairs
WHEN NOT(OLD.status='pending' AND NEW.status='completed'
 AND NEW.completed_at>=OLD.prepared_at
 AND NEW.request_id=OLD.request_id AND NEW.entry_id=OLD.entry_id
 AND NEW.resource_id=OLD.resource_id AND NEW.object_id=OLD.object_id
 AND NEW.household_id=OLD.household_id AND NEW.owner_user_id=OLD.owner_user_id
 AND NEW.byte_sha256=OLD.byte_sha256 AND NEW.prepared_at=OLD.prepared_at)
BEGIN SELECT RAISE(ABORT,'LEGACY_RECEIPT_REPAIR_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_legacy_receipt_repair_no_delete
BEFORE DELETE ON family_legacy_shared_receipt_repairs
BEGIN SELECT RAISE(ABORT,'LEGACY_RECEIPT_REPAIR_IMMUTABLE'); END;
INSERT OR IGNORE INTO schema_migrations(version,description)
VALUES('schema-0059-legacy-shared-receipt-repair',
'UNDEPLOYED owner-only resumable missing shared R2 byte recovery, immutable original retained');
