-- UNDEPLOYED 0058: extend ONLY the immutable HomeFlow-approved ordinary
-- mutation receipt guard to original-owner adopted 0055/0057 entries.
-- All prior approver, version, payload, household, audit and member checks
-- remain mandatory; no legacy financial journal or unsupported transfer.
-- Must apply after 0055/0057. No data backfill or production change here.
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
    AND e.type IN('expense','income') AND e.family_transfer_target_account_id IS NULL
    AND ((e.client_request_id='hfshare:'||r.resource_id AND e.family_account_id IS NULL)
      OR EXISTS(SELECT 1 FROM family_legacy_shared_adoptions adopted
       JOIN family_financial_accounts acct ON acct.account_id=adopted.account_id
       WHERE adopted.resource_id=r.resource_id AND adopted.entry_id=e.id
       AND adopted.household_id=NEW.household_id
       AND adopted.original_owner_user_id=NEW.approver_user_id
       AND adopted.original_client_request_id IS e.client_request_id
       AND adopted.account_id=e.family_account_id
       AND acct.owner_user_id=NEW.approver_user_id
       AND acct.household_id=NEW.household_id AND acct.is_archived=0))))
  OR (NEW.action='delete' AND r.state='deleted'
   AND NOT EXISTS(SELECT 1 FROM entries e WHERE e.id=r.entry_id))
 )
)
BEGIN SELECT RAISE(ABORT,'SHARED_MUTATION_APPLIED_COUNTERPART_INVALID'); END;

INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(
 'schema-0058-adopted-shared-mutation-approval',
 'UNDEPLOYED adopted legacy entries support signed owner-approved member mutation with exact source CAS');
