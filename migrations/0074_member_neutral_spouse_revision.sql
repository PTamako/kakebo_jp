-- 0074: Only the creating member may revise, trash or restore their own
-- account-free neutral spouse transfer, without a HomeFlow administrator review.
-- All owner-only household income/expense and adopted legacy guards remain.
-- Migration changes the trigger only, not existing financial rows or journals.
DROP TRIGGER IF EXISTS trg_shared_entry_registry_transition;
CREATE TRIGGER trg_shared_entry_registry_transition BEFORE UPDATE ON family_shared_entry_registry
WHEN NOT EXISTS (
 SELECT 1 FROM family_shared_entry_write_context c
 JOIN homeflow_identity_links actor ON actor.user_id=c.actor_user_id
 WHERE c.resource_id=OLD.resource_id AND c.entry_id=OLD.entry_id
 AND c.expected_version=OLD.version AND c.actor_user_id=NEW.last_actor_user_id
 AND actor.household_id=OLD.household_id AND actor.state='active'
 AND (actor.role='owner' OR (
  actor.role='member' AND OLD.creator_user_id=actor.user_id
  AND c.action IN('update','delete','restore')
  AND OLD.snapshot_json IS NOT NULL AND NEW.snapshot_json IS NOT NULL
  AND json_extract(OLD.snapshot_json,'$.type')='transfer'
  AND json_extract(OLD.snapshot_json,'$.transfer_target')='spouse'
  AND json_extract(OLD.snapshot_json,'$.transfer_date')=json_extract(OLD.snapshot_json,'$.date')
  AND json_extract(NEW.snapshot_json,'$.type')='transfer'
  AND json_extract(NEW.snapshot_json,'$.transfer_target')='spouse'
  AND json_extract(NEW.snapshot_json,'$.transfer_date')=json_extract(NEW.snapshot_json,'$.date')
  AND NOT EXISTS(SELECT 1 FROM family_legacy_shared_adoptions a WHERE a.resource_id=OLD.resource_id)
 ))
 AND NEW.version=OLD.version+1 AND NEW.updated_at>=OLD.updated_at
 AND NEW.payload_sha256<>'' AND (
  (OLD.state='active' AND NEW.state='active' AND c.action='update'
   AND EXISTS(SELECT 1 FROM entries e WHERE e.id=OLD.entry_id
    AND (e.type IN('expense','income') OR (e.type='transfer' AND e.transfer_target='spouse' AND COALESCE(e.transfer_applied,0)=0 AND e.family_account_id IS NULL AND e.client_request_id LIKE 'hfshare:%'))
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

INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(
 'schema-0074-member-neutral-spouse-revision',
 'Allow member-owned neutral spouse transfer revisions with immutable audit and CAS; household income/expense remains owner reviewed');
