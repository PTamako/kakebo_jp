-- DRAFT 0056: resumable OWNER-CONFIRMED verified byte copy, not adoption.
-- Never automatically delete old R2 keys or expose them to the shared UI.
-- Must not execute on production without separate Stage F authorization.
CREATE TABLE IF NOT EXISTS family_legacy_shared_receipt_copies(
 entry_id INTEGER PRIMARY KEY CHECK(entry_id>0),
 resource_id TEXT NOT NULL UNIQUE CHECK(length(resource_id)=32),
 object_id TEXT NOT NULL UNIQUE CHECK(length(object_id)=32),
 household_id TEXT NOT NULL,
 owner_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 source_snapshot_sha256 TEXT NOT NULL CHECK(length(source_snapshot_sha256)=64),
 source_object_key_sha256 TEXT NOT NULL CHECK(length(source_object_key_sha256)=64),
 source_http_etag TEXT NOT NULL CHECK(length(source_http_etag) BETWEEN 3 AND 150),
 byte_sha256 TEXT NOT NULL CHECK(length(byte_sha256)=64),
 size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 204800),
 content_type TEXT NOT NULL CHECK(content_type IN('image/webp','image/jpeg')),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN('pending','verified')),
 created_at INTEGER NOT NULL CHECK(created_at>0),
 verified_at INTEGER,
 CHECK((state='pending' AND verified_at IS NULL) OR
       (state='verified' AND verified_at>=created_at))
);
CREATE TRIGGER IF NOT EXISTS trg_legacy_shared_receipt_copy_owner BEFORE INSERT
ON family_legacy_shared_receipt_copies
WHEN NEW.state<>'pending' OR NEW.verified_at IS NOT NULL OR NOT EXISTS(
 SELECT 1 FROM family_finance_legacy_entry_links l
 JOIN homeflow_identity_links owner ON owner.user_id=l.actor_user_id
 JOIN family_financial_accounts a ON a.account_id=l.account_id
 JOIN entries e ON e.id=l.entry_id
 JOIN receipt_r2_state rs ON rs.entry_id=e.id
 WHERE l.entry_id=NEW.entry_id AND l.household_id=NEW.household_id
 AND l.actor_user_id=NEW.owner_user_id AND l.account_id=NEW.account_id
 AND owner.household_id=NEW.household_id AND owner.role='owner' AND owner.state='active'
 AND a.owner_user_id=NEW.owner_user_id AND a.household_id=NEW.household_id
 AND a.is_archived=0 AND e.family_account_id=NEW.account_id
 AND e.payment_source=l.original_source AND e.type IN('income','expense')
 AND e.family_transfer_target_account_id IS NULL AND rs.deleted=0
 AND NOT EXISTS(SELECT 1 FROM family_shared_entry_registry reg WHERE reg.entry_id=e.id)
)
BEGIN SELECT RAISE(ABORT,'LEGACY_RECEIPT_COPY_OWNER_OR_SOURCE_INVALID'); END;
CREATE TRIGGER IF NOT EXISTS trg_legacy_shared_receipt_copy_identity
BEFORE UPDATE OF entry_id,resource_id,object_id,household_id,owner_user_id,account_id,
 source_snapshot_sha256,source_object_key_sha256,source_http_etag,byte_sha256,
 size_bytes,content_type,created_at
ON family_legacy_shared_receipt_copies
BEGIN SELECT RAISE(ABORT,'LEGACY_RECEIPT_COPY_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_legacy_shared_receipt_copy_state
BEFORE UPDATE ON family_legacy_shared_receipt_copies
WHEN NOT(OLD.state='pending' AND NEW.state='verified'
 AND NEW.verified_at IS NOT NULL AND NEW.verified_at>=OLD.created_at
 AND EXISTS(SELECT 1 FROM receipt_r2_state rs
    WHERE rs.entry_id=OLD.entry_id AND rs.deleted=0)
 AND EXISTS(SELECT 1 FROM homeflow_identity_links owner
    WHERE owner.user_id=OLD.owner_user_id AND owner.household_id=OLD.household_id
    AND owner.role='owner' AND owner.state='active'))
BEGIN SELECT RAISE(ABORT,'LEGACY_RECEIPT_COPY_STATE_INVALID'); END;
CREATE TRIGGER IF NOT EXISTS trg_legacy_shared_receipt_copy_no_delete
BEFORE DELETE ON family_legacy_shared_receipt_copies
BEGIN SELECT RAISE(ABORT,'LEGACY_RECEIPT_COPY_IMMUTABLE'); END;
CREATE TABLE IF NOT EXISTS family_legacy_shared_receipt_copy_audit(
 event_id TEXT PRIMARY KEY CHECK(length(event_id)=32),
 entry_id INTEGER NOT NULL REFERENCES family_legacy_shared_receipt_copies(entry_id) ON DELETE RESTRICT,
 owner_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id),
 action TEXT NOT NULL CHECK(action IN('prepared','verified')),
 source_snapshot_sha256 TEXT NOT NULL CHECK(length(source_snapshot_sha256)=64),
 occurred_at INTEGER NOT NULL CHECK(occurred_at>0),
 UNIQUE(entry_id,action)
);
CREATE TRIGGER IF NOT EXISTS trg_legacy_shared_receipt_copy_audit_insert
AFTER INSERT ON family_legacy_shared_receipt_copies
BEGIN
 INSERT INTO family_legacy_shared_receipt_copy_audit
 (event_id,entry_id,owner_user_id,action,source_snapshot_sha256,occurred_at)
 VALUES(lower(hex(randomblob(16))),NEW.entry_id,NEW.owner_user_id,
 'prepared',NEW.source_snapshot_sha256,NEW.created_at);
END;
CREATE TRIGGER IF NOT EXISTS trg_legacy_shared_receipt_copy_audit_verify
AFTER UPDATE OF state ON family_legacy_shared_receipt_copies
WHEN NEW.state='verified'
BEGIN
 INSERT INTO family_legacy_shared_receipt_copy_audit
 (event_id,entry_id,owner_user_id,action,source_snapshot_sha256,occurred_at)
 VALUES(lower(hex(randomblob(16))),NEW.entry_id,NEW.owner_user_id,
 'verified',NEW.source_snapshot_sha256,NEW.verified_at);
END;
CREATE TRIGGER IF NOT EXISTS trg_legacy_shared_receipt_copy_audit_update
BEFORE UPDATE ON family_legacy_shared_receipt_copy_audit
BEGIN SELECT RAISE(ABORT,'LEGACY_RECEIPT_COPY_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_legacy_shared_receipt_copy_audit_delete
BEFORE DELETE ON family_legacy_shared_receipt_copy_audit
BEGIN SELECT RAISE(ABORT,'LEGACY_RECEIPT_COPY_AUDIT_IMMUTABLE'); END;
INSERT OR IGNORE INTO schema_migrations(version,description)
VALUES('schema-0056-legacy-shared-receipt-copy',
'UNDEPLOYED verified owner-only resumable byte-copy, never adopt or delete legacy source');
