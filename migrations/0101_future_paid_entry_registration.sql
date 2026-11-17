-- 0101 future-only personal card/prepaid charge registration.
-- Requires migration 0100. Never adopts or changes old charges.
-- Preserve all neutral-spouse and legacy-adoption restrictions.
DROP TRIGGER IF EXISTS trg_shared_entry_registry_guard;
CREATE TRIGGER trg_shared_entry_registry_guard BEFORE INSERT ON family_shared_entry_registry
WHEN NEW.state<>'active' OR NEW.version<>1
 OR NOT EXISTS(SELECT 1 FROM family_shared_entry_write_context c
  WHERE c.resource_id=NEW.resource_id AND c.entry_id=NEW.entry_id
  AND c.actor_user_id=NEW.creator_user_id AND c.action='create' AND c.expected_version=0)
 OR NOT EXISTS(SELECT 1 FROM homeflow_identity_links actor
  WHERE actor.user_id=NEW.creator_user_id AND actor.household_id=NEW.household_id
  AND actor.state='active' AND (actor.role='owner' OR
    (actor.role='member' AND (EXISTS(
      SELECT 1 FROM entries m WHERE m.id=NEW.entry_id
      AND m.type='transfer' AND m.transfer_target='spouse'
      AND COALESCE(m.transfer_applied,0)=0
      AND m.family_account_id IS NULL
      AND m.family_transfer_target_account_id IS NULL
      AND m.client_request_id='hfshare:'||NEW.resource_id)
 OR EXISTS(SELECT 1 FROM family_card_purchase_applied paid JOIN entries m ON m.id=paid.entry_id
 WHERE paid.entry_id=NEW.entry_id AND paid.household_id=NEW.household_id
 AND paid.requester_user_id=NEW.creator_user_id
 AND m.client_request_id='hfcard:'||paid.homeflow_request_id)
 OR EXISTS(SELECT 1 FROM family_prepaid_actions_applied paid JOIN entries m ON m.id=paid.entry_id
 WHERE paid.entry_id=NEW.entry_id AND paid.household_id=NEW.household_id
 AND paid.requester_user_id=NEW.creator_user_id
 AND paid.action='spend'
 AND m.client_request_id='hfprepaid:'||paid.homeflow_request_id)))))
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
       AND a.account_id=e.family_account_id)
 OR EXISTS(SELECT 1 FROM family_card_purchase_applied paid
 WHERE paid.entry_id=e.id AND paid.household_id=NEW.household_id
 AND paid.requester_user_id=NEW.creator_user_id
 AND e.client_request_id='hfcard:'||paid.homeflow_request_id)
 OR EXISTS(SELECT 1 FROM family_prepaid_actions_applied paid
 WHERE paid.entry_id=e.id AND paid.household_id=NEW.household_id
 AND paid.requester_user_id=NEW.creator_user_id
 AND paid.action='spend'
 AND e.client_request_id='hfprepaid:'||paid.homeflow_request_id)))
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
    AND (e.type IN('expense','income') OR (e.type='transfer' AND e.transfer_target='spouse' AND COALESCE(e.transfer_applied,0)=0 AND e.family_account_id IS NULL AND e.client_request_id LIKE 'hfshare:%'))
    AND ((e.client_request_id='hfshare:'||OLD.resource_id AND e.family_account_id IS NULL)
     OR EXISTS(SELECT 1 FROM family_legacy_shared_adoptions a
      WHERE a.resource_id=OLD.resource_id AND a.entry_id=e.id
      AND a.account_id=e.family_account_id
      AND a.original_client_request_id IS e.client_request_id)
 OR EXISTS(SELECT 1 FROM family_card_purchase_applied paid
 WHERE paid.entry_id=e.id AND paid.household_id=OLD.household_id
 
 AND e.client_request_id='hfcard:'||paid.homeflow_request_id)
 OR EXISTS(SELECT 1 FROM family_prepaid_actions_applied paid
 WHERE paid.entry_id=e.id AND paid.household_id=OLD.household_id
 
 AND paid.action='spend'
 AND e.client_request_id='hfprepaid:'||paid.homeflow_request_id))))
  OR (OLD.state='active' AND NEW.state='deleted' AND c.action='delete'
   AND (NOT EXISTS(SELECT 1 FROM entries e WHERE e.id=OLD.entry_id)
    OR EXISTS(SELECT 1 FROM entries e
      JOIN family_approved_account_corrections correction ON correction.entry_id=e.id
      WHERE e.id=OLD.entry_id AND e.type='expense' AND e.amount=0
       AND correction.version_before=OLD.version
       AND correction.version_after=NEW.version
       AND correction.approver_user_id=c.actor_user_id
       AND (EXISTS(SELECT 1 FROM family_card_purchase_applied paid
         WHERE paid.entry_id=e.id AND e.client_request_id='hfcard:'||paid.homeflow_request_id)
        OR EXISTS(SELECT 1 FROM family_prepaid_actions_applied paid
         WHERE paid.entry_id=e.id AND paid.action='spend'
          AND e.client_request_id='hfprepaid:'||paid.homeflow_request_id)))))
  OR (OLD.state='deleted' AND NEW.state='active' AND c.action='restore'
   AND EXISTS(SELECT 1 FROM entries e WHERE e.id=OLD.entry_id
    AND ((e.client_request_id='hfshare:'||OLD.resource_id AND e.family_account_id IS NULL)
     OR EXISTS(SELECT 1 FROM family_legacy_shared_adoptions a
      WHERE a.resource_id=OLD.resource_id AND a.entry_id=e.id
      AND a.account_id=e.family_account_id
      AND a.original_client_request_id IS e.client_request_id)
 OR EXISTS(SELECT 1 FROM family_card_purchase_applied paid
 WHERE paid.entry_id=e.id AND paid.household_id=OLD.household_id
 
 AND e.client_request_id='hfcard:'||paid.homeflow_request_id)
 OR EXISTS(SELECT 1 FROM family_prepaid_actions_applied paid
 WHERE paid.entry_id=e.id AND paid.household_id=OLD.household_id
 
 AND paid.action='spend'
 AND e.client_request_id='hfprepaid:'||paid.homeflow_request_id))))
  OR (OLD.state='deleted' AND NEW.state='purge_pending' AND c.action='purge'
   AND NEW.snapshot_json IS NULL)
  OR (OLD.state='purge_pending' AND NEW.state='purged' AND c.action='purge'
   AND NEW.snapshot_json IS NULL)
 ))
BEGIN SELECT RAISE(ABORT,'SHARED_ENTRY_TRANSITION_OR_CAS_INVALID'); END;

DROP TRIGGER IF EXISTS trg_shared_mutation_applied_guard;
CREATE TRIGGER trg_shared_mutation_applied_guard
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
    AND (e.type IN('expense','income') OR (e.type='transfer' AND e.transfer_target='spouse' AND COALESCE(e.transfer_applied,0)=0 AND e.family_account_id IS NULL AND e.client_request_id LIKE 'hfshare:%')) AND e.family_transfer_target_account_id IS NULL
    AND ((e.client_request_id='hfshare:'||r.resource_id AND e.family_account_id IS NULL)
      OR EXISTS(SELECT 1 FROM family_legacy_shared_adoptions adopted
       JOIN family_financial_accounts acct ON acct.account_id=adopted.account_id
       WHERE adopted.resource_id=r.resource_id AND adopted.entry_id=e.id
       AND adopted.household_id=NEW.household_id
       AND adopted.original_owner_user_id=NEW.approver_user_id
       AND adopted.original_client_request_id IS e.client_request_id
       AND adopted.account_id=e.family_account_id
       AND acct.owner_user_id=NEW.approver_user_id
       AND acct.household_id=NEW.household_id AND acct.is_archived=0)
 OR EXISTS(SELECT 1 FROM family_card_purchase_applied paid
 WHERE paid.entry_id=e.id AND paid.household_id=NEW.household_id
 
 AND e.client_request_id='hfcard:'||paid.homeflow_request_id)
 OR EXISTS(SELECT 1 FROM family_prepaid_actions_applied paid
 WHERE paid.entry_id=e.id AND paid.household_id=NEW.household_id
 
 AND paid.action='spend'
 AND e.client_request_id='hfprepaid:'||paid.homeflow_request_id))))
  OR (NEW.action='delete' AND r.state='deleted'
   AND (NOT EXISTS(SELECT 1 FROM entries e WHERE e.id=r.entry_id)
    OR EXISTS(SELECT 1 FROM entries e
     JOIN family_approved_account_corrections correction ON correction.entry_id=e.id
     WHERE e.id=r.entry_id AND e.amount=0 AND e.type='expense'
      AND correction.proposal_id=NEW.proposal_id
      AND correction.homeflow_request_id=NEW.homeflow_request_id
      AND correction.version_after=NEW.version_after)))
 )
)
BEGIN SELECT RAISE(ABORT,'SHARED_MUTATION_APPLIED_COUNTERPART_INVALID'); END;

-- The prepaid entry remains physically linked to immutable original evidence.
-- Permit ONLY an owner-approved, versioned correction that already has its
-- signed durable row in the SAME transaction.
DROP TRIGGER IF EXISTS trg_family_prepaid_applied_entry_no_update;
CREATE TRIGGER trg_family_prepaid_applied_entry_no_update
 BEFORE UPDATE ON entries
 WHEN EXISTS(SELECT 1 FROM family_prepaid_actions_applied a WHERE a.entry_id=OLD.id)
 AND NOT EXISTS(
 SELECT 1 FROM family_approved_account_corrections correction
 JOIN family_shared_entry_registry registry ON registry.entry_id=correction.entry_id
 JOIN family_shared_entry_write_context context ON context.resource_id=registry.resource_id
 WHERE correction.entry_id=OLD.id
 AND correction.version_before=registry.version
 AND correction.version_after=registry.version+1
 AND context.entry_id=OLD.id AND context.action IN('update','delete','restore')
 AND context.actor_user_id=correction.approver_user_id
 AND json_extract(correction.before_json,'$.amount')=OLD.amount
 AND json_extract(correction.before_json,'$.date')=OLD.date
 AND json_extract(correction.before_json,'$.accountId')=OLD.family_account_id
 AND json_extract(correction.after_json,'$.amount')=NEW.amount
 AND json_extract(correction.after_json,'$.date')=NEW.date
 AND json_extract(correction.after_json,'$.accountId')=NEW.family_account_id
 )
 BEGIN SELECT RAISE(ABORT,'PREPAID_ENTRY_IMMUTABLE'); END;
-- Authorized future-paid delete/restore uses a zero-value physical
-- tombstone, not DELETE or INSERT: the original immutable purchase references
-- entries.id via a RESTRICT foreign key. Never relax owner-approved UPDATE.
DROP TRIGGER IF EXISTS trg_shared_entry_guard_update;
CREATE TRIGGER trg_shared_entry_guard_update BEFORE UPDATE ON entries
WHEN EXISTS(SELECT 1 FROM family_shared_entry_registry r WHERE r.entry_id=OLD.id)
AND NOT EXISTS(
 SELECT 1 FROM family_shared_entry_write_context c
 JOIN family_shared_entry_registry r ON r.resource_id=c.resource_id
 WHERE c.entry_id=OLD.id AND r.entry_id=OLD.id
 AND (c.action='update' OR
   (c.action IN('delete','restore') AND EXISTS(
    SELECT 1 FROM family_approved_account_corrections correction
    WHERE correction.entry_id=OLD.id AND correction.version_before=r.version
     AND correction.version_after=r.version+1
     AND correction.approver_user_id=c.actor_user_id
     AND correction.version_before=c.expected_version
     AND json_extract(correction.before_json,'$.amount')=OLD.amount
     AND json_extract(correction.after_json,'$.amount')=NEW.amount
     AND json_extract(correction.before_json,'$.date')=OLD.date
     AND json_extract(correction.after_json,'$.date')=NEW.date
     AND json_extract(correction.before_json,'$.accountId')=OLD.family_account_id
     AND json_extract(correction.after_json,'$.accountId')=NEW.family_account_id
     AND (EXISTS(SELECT 1 FROM family_card_purchase_applied paid
      WHERE paid.entry_id=OLD.id AND OLD.client_request_id='hfcard:'||paid.homeflow_request_id)
      OR EXISTS(SELECT 1 FROM family_prepaid_actions_applied paid
      WHERE paid.entry_id=OLD.id AND paid.action='spend'
       AND OLD.client_request_id='hfprepaid:'||paid.homeflow_request_id))
   )))
)
BEGIN SELECT RAISE(ABORT,'SHARED_ENTRY_APPROVAL_CONTEXT_REQUIRED'); END;

INSERT OR IGNORE INTO schema_migrations(version,description)
 VALUES('schema-0101-future-paid-entry-registration',
 'Future-only member credit/prepaid purchase registry with authenticated owner-reviewed correction precondition');
