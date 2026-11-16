-- 0052 DRAFT: member-proposed ordinary shared entry mutation, approved ONLY
-- through existing HomeFlow owner approval and its signed leased executor.
-- A single Kakeibo D1 batch must include the original revision and immutable receipt.
CREATE TABLE IF NOT EXISTS family_shared_mutation_intents(
 proposal_id TEXT PRIMARY KEY CHECK(length(proposal_id)=32),
 household_id TEXT NOT NULL,
 requester_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 operation TEXT NOT NULL CHECK(operation IN('create','update','delete','restore')),
 resource_id TEXT CHECK(resource_id IS NULL OR length(resource_id)=32),
 expected_version INTEGER NOT NULL CHECK(expected_version>=0),
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 payload_cipher TEXT NOT NULL,payload_iv TEXT NOT NULL,
 idempotency_hash TEXT NOT NULL UNIQUE CHECK(length(idempotency_hash)=64),
 status TEXT NOT NULL DEFAULT 'prepared' CHECK(status IN('prepared','submitted','cancelled')),
 homeflow_approval_id TEXT UNIQUE CHECK(homeflow_approval_id IS NULL OR length(homeflow_approval_id)=36),
 created_at INTEGER NOT NULL CHECK(created_at>0),
 expires_at INTEGER NOT NULL CHECK(expires_at>created_at),
 submitted_at INTEGER,
 CHECK((operation='create' AND resource_id IS NULL AND expected_version=0)
 OR (operation<>'create' AND resource_id IS NOT NULL AND expected_version>=1))
);
CREATE INDEX IF NOT EXISTS idx_shared_mutation_proposals_user
 ON family_shared_mutation_intents(household_id,requester_user_id,created_at DESC);
CREATE TRIGGER IF NOT EXISTS trg_shared_mutation_intent_create_guard
BEFORE INSERT ON family_shared_mutation_intents
WHEN NOT EXISTS(SELECT 1 FROM homeflow_identity_links l
 WHERE l.user_id=NEW.requester_user_id AND l.household_id=NEW.household_id
 AND l.state='active' AND l.role='member')
 OR (NEW.operation<>'create' AND NOT EXISTS(SELECT 1 FROM family_shared_entry_registry r
 WHERE r.resource_id=NEW.resource_id AND r.household_id=NEW.household_id
 AND r.version=NEW.expected_version AND r.state=
 CASE WHEN NEW.operation='restore' THEN 'deleted' ELSE 'active' END))
BEGIN SELECT RAISE(ABORT,'SHARED_MUTATION_REQUESTER_OR_VERSION'); END;
CREATE TRIGGER IF NOT EXISTS trg_shared_mutation_intent_immutable
BEFORE UPDATE OF proposal_id,household_id,requester_user_id,operation,resource_id,
 expected_version,payload_sha256,payload_cipher,payload_iv,idempotency_hash,
 created_at,expires_at ON family_shared_mutation_intents
BEGIN SELECT RAISE(ABORT,'SHARED_MUTATION_INTENT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_shared_mutation_intent_status_guard
BEFORE UPDATE ON family_shared_mutation_intents
WHEN NOT(OLD.status='prepared' AND NEW.status IN('submitted','cancelled'))
BEGIN SELECT RAISE(ABORT,'SHARED_MUTATION_INTENT_STATE'); END;
CREATE TRIGGER IF NOT EXISTS trg_shared_mutation_intent_no_delete
BEFORE DELETE ON family_shared_mutation_intents
BEGIN SELECT RAISE(ABORT,'SHARED_MUTATION_INTENT_IMMUTABLE'); END;
CREATE TABLE IF NOT EXISTS family_shared_mutation_applied(
 homeflow_request_id TEXT PRIMARY KEY CHECK(length(homeflow_request_id)=36),
 proposal_id TEXT NOT NULL UNIQUE REFERENCES family_shared_mutation_intents(proposal_id) ON DELETE RESTRICT,
 household_id TEXT NOT NULL,
 requester_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 approver_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 actor_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 resource_id TEXT NOT NULL REFERENCES family_shared_entry_registry(resource_id) ON DELETE RESTRICT,
 entry_id INTEGER NOT NULL CHECK(entry_id>0),
 action TEXT NOT NULL CHECK(action IN('create','update','delete','restore')),
 version_before INTEGER NOT NULL CHECK(version_before>=0),
 version_after INTEGER NOT NULL CHECK(version_after=version_before+1),
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 applied_at INTEGER NOT NULL CHECK(applied_at>0),
 CHECK(requester_user_id<>approver_user_id AND actor_user_id=approver_user_id)
);
CREATE TRIGGER IF NOT EXISTS trg_shared_mutation_applied_guard
BEFORE INSERT ON family_shared_mutation_applied
WHEN NOT EXISTS(
 SELECT 1 FROM family_shared_mutation_intents p
 JOIN family_shared_entry_registry r ON r.resource_id=NEW.resource_id
 JOIN family_shared_entry_audit audit ON audit.resource_id=r.resource_id
 JOIN homeflow_identity_links member ON member.user_id=p.requester_user_id
 JOIN homeflow_identity_links owner ON owner.user_id=NEW.approver_user_id
 WHERE p.proposal_id=NEW.proposal_id AND p.status='submitted'
 AND p.homeflow_approval_id=NEW.homeflow_request_id
 AND p.household_id=NEW.household_id AND p.requester_user_id=NEW.requester_user_id
 AND p.operation=NEW.action AND p.expected_version=NEW.version_before
 AND p.payload_sha256=NEW.payload_sha256 AND p.expires_at>NEW.applied_at
 AND (p.resource_id IS NULL OR p.resource_id=NEW.resource_id)
 AND r.household_id=NEW.household_id AND r.entry_id=NEW.entry_id
 AND r.version=NEW.version_after AND r.last_actor_user_id=NEW.actor_user_id
 AND audit.to_version=NEW.version_after AND audit.action=NEW.action
 AND audit.actor_user_id=NEW.actor_user_id
 AND member.household_id=NEW.household_id AND member.role='member' AND member.state='active'
 AND owner.household_id=NEW.household_id AND owner.role='owner' AND owner.state='active'
 AND (
  (NEW.action IN('create','update','restore') AND r.state='active'
   AND EXISTS(SELECT 1 FROM entries e WHERE e.id=r.entry_id
    AND e.client_request_id='hfshare:'||r.resource_id AND e.type IN('expense','income')))
  OR (NEW.action='delete' AND r.state='deleted'
   AND NOT EXISTS(SELECT 1 FROM entries e WHERE e.id=r.entry_id))
 )
)
BEGIN SELECT RAISE(ABORT,'SHARED_MUTATION_APPLIED_COUNTERPART_INVALID'); END;
CREATE TRIGGER IF NOT EXISTS trg_shared_mutation_applied_immutable_update
BEFORE UPDATE ON family_shared_mutation_applied
BEGIN SELECT RAISE(ABORT,'SHARED_MUTATION_RECEIPT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_shared_mutation_applied_immutable_delete
BEFORE DELETE ON family_shared_mutation_applied
BEGIN SELECT RAISE(ABORT,'SHARED_MUTATION_RECEIPT_IMMUTABLE'); END;
INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(
 'schema-0052-shared-mutation-approved-execution',
 'UNDEPLOYED member-proposed shared entry mutation and one-approval one-immutable-journal');
