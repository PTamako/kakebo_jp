-- 0069: A live household member may post ONE account-free spouse transfer
-- directly. Preserve 0068 owner-only income/expense and all legacy adoption
-- and shared mutation guards; revisions still need the owner's review.
DROP TRIGGER IF EXISTS trg_shared_entry_registry_guard;
CREATE TRIGGER trg_shared_entry_registry_guard BEFORE INSERT ON family_shared_entry_registry
WHEN NEW.state<>'active' OR NEW.version<>1
 OR NOT EXISTS(SELECT 1 FROM family_shared_entry_write_context c
  WHERE c.resource_id=NEW.resource_id AND c.entry_id=NEW.entry_id
  AND c.actor_user_id=NEW.creator_user_id AND c.action='create' AND c.expected_version=0)
 OR NOT EXISTS(SELECT 1 FROM homeflow_identity_links actor
  WHERE actor.user_id=NEW.creator_user_id AND actor.household_id=NEW.household_id
  AND actor.state='active' AND (actor.role='owner' OR
    (actor.role='member' AND EXISTS(
      SELECT 1 FROM entries m WHERE m.id=NEW.entry_id
      AND m.type='transfer' AND m.transfer_target='spouse'
      AND COALESCE(m.transfer_applied,0)=0
      AND m.family_account_id IS NULL
      AND m.family_transfer_target_account_id IS NULL
      AND m.client_request_id='hfshare:'||NEW.resource_id))))
 OR NOT EXISTS(SELECT 1 FROM entries e WHERE e.id=NEW.entry_id
  AND (e.type IN('expense','income') OR (e.type='transfer' AND e.transfer_target='spouse' AND COALESCE(e.transfer_applied,0)=0 AND e.family_account_id IS NULL AND e.client_request_id LIKE 'hfshare:%')) AND e.amount>0
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

INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(
 'schema-0069-member-neutral-spouse-transfer',
 'Allow member-created neutral spouse transfers only; no member income/expense bypass');
