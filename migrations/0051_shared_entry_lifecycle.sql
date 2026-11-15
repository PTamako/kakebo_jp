-- 0051 DRAFT: only ordinary shared income/expense, never posted finance journals.
-- Keep the existing D1 entries and aggregates as the single counting source.
-- Registry is an identity/CAS envelope; audit records are immutable.
CREATE TABLE IF NOT EXISTS family_shared_entry_registry(
 resource_id TEXT PRIMARY KEY CHECK(length(resource_id)=32 AND resource_id NOT GLOB '*[^0-9a-f]*'),
 household_id TEXT NOT NULL,
 entry_id INTEGER NOT NULL UNIQUE CHECK(entry_id>0),
 creator_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 last_actor_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 state TEXT NOT NULL DEFAULT 'active' CHECK(state IN('active','deleted','purge_pending','purged')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 snapshot_json TEXT CHECK(snapshot_json IS NULL OR json_valid(snapshot_json)),
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 created_at INTEGER NOT NULL CHECK(created_at>0),
 updated_at INTEGER NOT NULL CHECK(updated_at>0),
 deleted_at INTEGER, purged_at INTEGER,
 CHECK((state='purged' AND snapshot_json IS NULL AND purged_at IS NOT NULL)
 OR (state='purge_pending' AND snapshot_json IS NULL AND purged_at IS NULL)
 OR (state IN('active','deleted') AND snapshot_json IS NOT NULL AND purged_at IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_shared_entry_household
 ON family_shared_entry_registry(household_id,state,updated_at DESC);
-- Per-SQL-batch authority: INSERT and DELETE within same SQLite transaction only.
-- Legacy APIs can never mutate a protected shared entry with no corresponding permit.
CREATE TABLE IF NOT EXISTS family_shared_entry_write_context(
 resource_id TEXT PRIMARY KEY,
 entry_id INTEGER NOT NULL,
 actor_user_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN('create','update','delete','restore','purge')),
 expected_version INTEGER NOT NULL CHECK(expected_version>=0),
 stamp INTEGER NOT NULL CHECK(stamp>0)
);
CREATE TRIGGER IF NOT EXISTS trg_shared_entry_guard_update BEFORE UPDATE ON entries
WHEN EXISTS(SELECT 1 FROM family_shared_entry_registry r WHERE r.entry_id=OLD.id)
AND NOT EXISTS(SELECT 1 FROM family_shared_entry_write_context c
 WHERE c.entry_id=OLD.id AND c.resource_id=
 (SELECT r.resource_id FROM family_shared_entry_registry r WHERE r.entry_id=OLD.id)
 AND c.action='update')
BEGIN SELECT RAISE(ABORT,'SHARED_ENTRY_APPROVAL_CONTEXT_REQUIRED'); END;
CREATE TRIGGER IF NOT EXISTS trg_shared_entry_guard_delete BEFORE DELETE ON entries
WHEN EXISTS(SELECT 1 FROM family_shared_entry_registry r WHERE r.entry_id=OLD.id)
AND NOT EXISTS(SELECT 1 FROM family_shared_entry_write_context c
 WHERE c.entry_id=OLD.id AND c.resource_id=
 (SELECT r.resource_id FROM family_shared_entry_registry r WHERE r.entry_id=OLD.id)
 AND c.action='delete')
BEGIN SELECT RAISE(ABORT,'SHARED_ENTRY_APPROVAL_CONTEXT_REQUIRED'); END;
CREATE TRIGGER IF NOT EXISTS trg_shared_entry_guard_reinsert BEFORE INSERT ON entries
WHEN NEW.client_request_id LIKE 'hfshare:%'
AND EXISTS(SELECT 1 FROM family_shared_entry_registry r WHERE r.entry_id=NEW.id)
AND NOT EXISTS(SELECT 1 FROM family_shared_entry_write_context c
 JOIN family_shared_entry_registry r ON r.resource_id=c.resource_id AND r.entry_id=c.entry_id
 WHERE c.entry_id=NEW.id AND c.action='restore' AND r.state='deleted')
BEGIN SELECT RAISE(ABORT,'SHARED_ENTRY_RESTORE_CONTEXT_REQUIRED'); END;
CREATE TABLE IF NOT EXISTS family_shared_entry_audit(
 audit_id TEXT PRIMARY KEY CHECK(length(audit_id)=32),
 resource_id TEXT NOT NULL REFERENCES family_shared_entry_registry(resource_id) ON DELETE RESTRICT,
 household_id TEXT NOT NULL,
 actor_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 action TEXT NOT NULL CHECK(action IN('create','update','delete','restore','purge')),
 from_version INTEGER NOT NULL CHECK(from_version>=0),
 to_version INTEGER NOT NULL CHECK(to_version=from_version+1),
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 occurred_at INTEGER NOT NULL CHECK(occurred_at>0),
 UNIQUE(resource_id,to_version)
);
CREATE TRIGGER IF NOT EXISTS trg_shared_entry_audit_no_update BEFORE UPDATE ON family_shared_entry_audit
BEGIN SELECT RAISE(ABORT,'SHARED_ENTRY_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_shared_entry_audit_no_delete BEFORE DELETE ON family_shared_entry_audit
BEGIN SELECT RAISE(ABORT,'SHARED_ENTRY_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_shared_entry_registry_guard BEFORE INSERT ON family_shared_entry_registry
WHEN NEW.state<>'active' OR NEW.version<>1
 OR NOT EXISTS(SELECT 1 FROM family_shared_entry_write_context c
  WHERE c.resource_id=NEW.resource_id AND c.entry_id=NEW.entry_id
  AND c.actor_user_id=NEW.creator_user_id AND c.action='create' AND c.expected_version=0)
 OR NOT EXISTS(SELECT 1 FROM entries e WHERE e.id=NEW.entry_id
  AND e.client_request_id='hfshare:'||NEW.resource_id
  AND e.type IN('expense','income') AND e.amount>0 AND e.family_account_id IS NULL
  AND e.family_transfer_target_account_id IS NULL)
 OR NOT EXISTS(SELECT 1 FROM homeflow_identity_links l
  WHERE l.user_id=NEW.creator_user_id AND l.household_id=NEW.household_id
  AND l.state='active' AND l.role='owner')
BEGIN SELECT RAISE(ABORT,'SHARED_ENTRY_CREATE_OWNER_OR_CONTEXT_INVALID'); END;
CREATE TRIGGER IF NOT EXISTS trg_shared_entry_registry_immutable
BEFORE UPDATE OF resource_id,household_id,entry_id,creator_user_id,created_at
ON family_shared_entry_registry
BEGIN SELECT RAISE(ABORT,'SHARED_ENTRY_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_shared_entry_registry_transition
BEFORE UPDATE ON family_shared_entry_registry
WHEN NOT EXISTS(
 SELECT 1 FROM family_shared_entry_write_context c
 JOIN homeflow_identity_links actor ON actor.user_id=c.actor_user_id
 WHERE c.resource_id=OLD.resource_id AND c.entry_id=OLD.entry_id
 AND c.expected_version=OLD.version AND c.actor_user_id=NEW.last_actor_user_id
 AND actor.household_id=OLD.household_id AND actor.state='active' AND actor.role='owner'
 AND NEW.version=OLD.version+1 AND NEW.updated_at>=OLD.updated_at
 AND NEW.payload_sha256<>'' AND (
  (OLD.state='active' AND NEW.state='active' AND c.action='update'
   AND EXISTS(SELECT 1 FROM entries e WHERE e.id=OLD.entry_id
    AND e.client_request_id='hfshare:'||OLD.resource_id
    AND e.type IN('expense','income') AND e.family_account_id IS NULL))
  OR (OLD.state='active' AND NEW.state='deleted' AND c.action='delete'
   AND NOT EXISTS(SELECT 1 FROM entries e WHERE e.id=OLD.entry_id))
  OR (OLD.state='deleted' AND NEW.state='active' AND c.action='restore'
   AND EXISTS(SELECT 1 FROM entries e WHERE e.id=OLD.entry_id
    AND e.client_request_id='hfshare:'||OLD.resource_id))
  OR (OLD.state='deleted' AND NEW.state='purge_pending' AND c.action='purge'
   AND NEW.snapshot_json IS NULL)
  OR (OLD.state='purge_pending' AND NEW.state='purged' AND c.action='purge'
   AND NEW.snapshot_json IS NULL)
 ))
BEGIN SELECT RAISE(ABORT,'SHARED_ENTRY_TRANSITION_OR_CAS_INVALID'); END;
-- Revision log inserted by the engine, not optional service-side bookkeeping.
CREATE TRIGGER IF NOT EXISTS trg_shared_entry_audit_create AFTER INSERT ON family_shared_entry_registry
BEGIN
 INSERT INTO family_shared_entry_audit(audit_id,resource_id,household_id,
 actor_user_id,action,from_version,to_version,payload_sha256,occurred_at)
 SELECT lower(hex(randomblob(16))),NEW.resource_id,NEW.household_id,
 c.actor_user_id,'create',0,1,NEW.payload_sha256,c.stamp
 FROM family_shared_entry_write_context c WHERE c.resource_id=NEW.resource_id AND c.action='create';
END;
CREATE TRIGGER IF NOT EXISTS trg_shared_entry_audit_update AFTER UPDATE ON family_shared_entry_registry
BEGIN
 INSERT INTO family_shared_entry_audit(audit_id,resource_id,household_id,
 actor_user_id,action,from_version,to_version,payload_sha256,occurred_at)
 SELECT lower(hex(randomblob(16))),NEW.resource_id,NEW.household_id,
 c.actor_user_id,c.action,OLD.version,NEW.version,NEW.payload_sha256,c.stamp
 FROM family_shared_entry_write_context c WHERE c.resource_id=NEW.resource_id;
END;
-- An untrusted client cannot invent R2 object keys. Each attachment is
-- separately namespaced and references stable resource_id, not reusable entry IDs.
CREATE TABLE IF NOT EXISTS family_shared_entry_attachments(
 object_id TEXT PRIMARY KEY CHECK(length(object_id)=32 AND object_id NOT GLOB '*[^0-9a-f]*'),
 resource_id TEXT NOT NULL REFERENCES family_shared_entry_registry(resource_id) ON DELETE RESTRICT,
 state TEXT NOT NULL CHECK(state IN('pending','ready','purge_pending','purged')),
 content_type TEXT NOT NULL CHECK(content_type IN('image/webp','image/jpeg')),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 size_bytes INTEGER NOT NULL CHECK(size_bytes BETWEEN 1 AND 204800),
 created_by_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id),
 created_at INTEGER NOT NULL CHECK(created_at>0),updated_at INTEGER NOT NULL,
 UNIQUE(resource_id,object_id)
);
CREATE INDEX IF NOT EXISTS idx_shared_entry_attachments_resource
 ON family_shared_entry_attachments(resource_id,state,object_id);
INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(
 'schema-0051-shared-entry-lifecycle',
 'UNDEPLOYED owner-gated ordinary shared entries, immutable revision audit, and R2 tombstones');
