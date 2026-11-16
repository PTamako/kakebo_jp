-- 0055 DRAFT / unexecuted: explicitly adopt legacy ordinary owner-linked entries.
-- No automatic migration or R2 copy; entries with old receipt state or live
-- objects are denied by the API. The existing ledger row is never duplicated.
CREATE TABLE IF NOT EXISTS family_legacy_shared_adoptions (
 resource_id TEXT PRIMARY KEY CHECK(length(resource_id)=32),
 entry_id INTEGER NOT NULL UNIQUE CHECK(entry_id>0),
 household_id TEXT NOT NULL,
 original_owner_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id),
 account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id),
 source_snapshot_sha256 TEXT NOT NULL CHECK(length(source_snapshot_sha256)=64),
 original_link_digest TEXT NOT NULL CHECK(length(original_link_digest)=64),
 original_client_request_id TEXT,
 original_row_json TEXT NOT NULL CHECK(json_valid(original_row_json)),
 adopted_at INTEGER NOT NULL CHECK(adopted_at>0)
);
CREATE INDEX IF NOT EXISTS idx_legacy_shared_adoptions_owner
 ON family_legacy_shared_adoptions(household_id,original_owner_user_id,entry_id);
CREATE TRIGGER IF NOT EXISTS trg_legacy_shared_adoptions_owner BEFORE INSERT
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
 AND NOT EXISTS(SELECT 1 FROM receipt_r2_state rs WHERE rs.entry_id=e.id)
 AND NOT EXISTS(SELECT 1 FROM family_shared_entry_registry r WHERE r.entry_id=e.id)
) BEGIN SELECT RAISE(ABORT,'LEGACY_SHARED_ADOPT_OWNER_OR_SOURCE_INVALID'); END;
CREATE TRIGGER IF NOT EXISTS trg_legacy_shared_adoptions_immutable_update BEFORE UPDATE
ON family_legacy_shared_adoptions BEGIN SELECT RAISE(ABORT,'LEGACY_SHARED_ADOPTION_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_legacy_shared_adoptions_immutable_delete BEFORE DELETE
ON family_legacy_shared_adoptions BEGIN SELECT RAISE(ABORT,'LEGACY_SHARED_ADOPTION_IMMUTABLE'); END;

-- Extend existing registry guard ONLY for a matching immutable adoption
-- recorded before registry creation. Ordinary hfshare: create stays unchanged.
DROP TRIGGER IF EXISTS trg_shared_entry_registry_guard;
CREATE TRIGGER trg_shared_entry_registry_guard BEFORE INSERT ON family_shared_entry_registry
WHEN NEW.state<>'active' OR NEW.version<>1
 OR NOT EXISTS(SELECT 1 FROM family_shared_entry_write_context c
  WHERE c.resource_id=NEW.resource_id AND c.entry_id=NEW.entry_id
  AND c.actor_user_id=NEW.creator_user_id AND c.action='create' AND c.expected_version=0)
 OR NOT EXISTS(SELECT 1 FROM homeflow_identity_links actor
  WHERE actor.user_id=NEW.creator_user_id AND actor.household_id=NEW.household_id
  AND actor.role='owner' AND actor.state='active')
 OR NOT EXISTS(SELECT 1 FROM entries e WHERE e.id=NEW.entry_id
  AND e.type IN('expense','income') AND e.amount>0
  AND e.family_transfer_target_account_id IS NULL
  AND ((e.client_request_id='hfshare:'||NEW.resource_id
       AND e.family_account_id IS NULL)
   OR EXISTS(SELECT 1 FROM family_legacy_shared_adoptions a
       WHERE a.resource_id=NEW.resource_id AND a.entry_id=e.id
       AND a.household_id=NEW.household_id
       AND a.original_owner_user_id=NEW.creator_user_id
       AND a.original_client_request_id IS e.client_request_id
       AND a.account_id=e.family_account_id)))
BEGIN SELECT RAISE(ABORT,'SHARED_ENTRY_CREATE_OWNER_OR_CONTEXT_INVALID'); END;

DROP TRIGGER IF EXISTS trg_shared_entry_registry_transition;
CREATE TRIGGER trg_shared_entry_registry_transition BEFORE UPDATE ON family_shared_entry_registry
WHEN NOT EXISTS (
 SELECT 1 FROM family_shared_entry_write_context c
 JOIN homeflow_identity_links actor ON actor.user_id=c.actor_user_id
 WHERE c.resource_id=OLD.resource_id AND c.entry_id=OLD.entry_id
 AND c.expected_version=OLD.version AND c.actor_user_id=NEW.last_actor_user_id
 AND actor.household_id=OLD.household_id AND actor.state='active' AND actor.role='owner'
 AND NEW.version=OLD.version+1 AND NEW.updated_at>=OLD.updated_at
 AND NEW.payload_sha256<>'' AND (
  (OLD.state='active' AND NEW.state='active' AND c.action='update'
   AND EXISTS(SELECT 1 FROM entries e WHERE e.id=OLD.entry_id
    AND e.type IN('expense','income')
    AND ((e.client_request_id='hfshare:'||OLD.resource_id AND e.family_account_id IS NULL)
     OR EXISTS(SELECT 1 FROM family_legacy_shared_adoptions a
      WHERE a.resource_id=OLD.resource_id AND a.entry_id=e.id
      AND a.account_id=e.family_account_id
      AND a.original_client_request_id IS e.client_request_id))))
  OR (OLD.state='active' AND NEW.state='deleted' AND c.action='delete'
   AND NOT EXISTS(SELECT 1 FROM entries e WHERE e.id=OLD.entry_id))
  OR (OLD.state='deleted' AND NEW.state='active' AND c.action='restore'
   AND EXISTS(SELECT 1 FROM entries e WHERE e.id=OLD.entry_id
    AND ((e.client_request_id='hfshare:'||OLD.resource_id AND e.family_account_id IS NULL)
     OR EXISTS(SELECT 1 FROM family_legacy_shared_adoptions a
      WHERE a.resource_id=OLD.resource_id AND a.entry_id=e.id
      AND a.account_id=e.family_account_id
      AND a.original_client_request_id IS e.client_request_id))))
  OR (OLD.state='deleted' AND NEW.state='purge_pending' AND c.action='purge'
   AND NEW.snapshot_json IS NULL)
  OR (OLD.state='purge_pending' AND NEW.state='purged' AND c.action='purge'
   AND NEW.snapshot_json IS NULL)
 ))
BEGIN SELECT RAISE(ABORT,'SHARED_ENTRY_TRANSITION_OR_CAS_INVALID'); END;

-- An adopted numeric original ID can only be reinserted by the guarded
-- shared-entry restore path, even with NULL legacy request ID.
CREATE TRIGGER IF NOT EXISTS trg_legacy_shared_entry_reinsert BEFORE INSERT ON entries
WHEN EXISTS(SELECT 1 FROM family_legacy_shared_adoptions a WHERE a.entry_id=NEW.id)
AND NOT EXISTS(SELECT 1 FROM family_shared_entry_write_context c
 JOIN family_shared_entry_registry r ON r.resource_id=c.resource_id
 WHERE r.entry_id=NEW.id AND c.entry_id=NEW.id AND c.action='restore'
 AND r.state='deleted')
BEGIN SELECT RAISE(ABORT,'LEGACY_SHARED_RESTORE_CONTEXT_REQUIRED'); END;
INSERT OR IGNORE INTO schema_migrations(version,description)
 VALUES('schema-0055-legacy-shared-entry-adoption',
 'UNDEPLOYED single-owner immutable adoption with preserved source fields and guarded shared lifecycle');