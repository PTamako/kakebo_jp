-- 0106: administrator edits household totals without taking ownership of
-- spouse private cards. No HomeFlow approval is required for the active owner;
-- a CAS-guarded append-only journal records the exact immutable original receipt.
CREATE TABLE IF NOT EXISTS family_owner_account_corrections (
 correction_id TEXT PRIMARY KEY CHECK(length(correction_id)=32),
 household_id TEXT NOT NULL,
 resource_id TEXT NOT NULL REFERENCES family_shared_entry_registry(resource_id) ON DELETE RESTRICT,
 entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE RESTRICT,
 owner_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 spender_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 version_before INTEGER NOT NULL CHECK(version_before>=1),
 version_after INTEGER NOT NULL CHECK(version_after=version_before+1),
 before_json TEXT NOT NULL CHECK(json_valid(before_json)),
 after_json TEXT NOT NULL CHECK(json_valid(after_json)),
 action TEXT NOT NULL CHECK(action IN ('update','delete','restore')),
 created_at INTEGER NOT NULL CHECK(created_at>0),
 UNIQUE(entry_id,version_after)
);
CREATE TRIGGER IF NOT EXISTS trg_owner_account_correction_guard
 BEFORE INSERT ON family_owner_account_corrections
 WHEN NOT EXISTS (
 SELECT 1 FROM family_shared_entry_registry registry
 JOIN entries e ON e.id=registry.entry_id
 JOIN homeflow_identity_links actor ON actor.user_id=NEW.owner_user_id
 JOIN family_shared_entry_write_context ctx ON ctx.resource_id=registry.resource_id
 LEFT JOIN family_card_purchase_applied card ON card.entry_id=e.id
 LEFT JOIN family_prepaid_actions_applied prepaid ON prepaid.entry_id=e.id AND prepaid.action='spend'
 JOIN family_financial_accounts acct ON acct.account_id=e.family_account_id
 WHERE registry.resource_id=NEW.resource_id AND registry.entry_id=NEW.entry_id
  AND registry.household_id=NEW.household_id AND registry.version=NEW.version_before
  AND registry.state=CASE WHEN NEW.action='restore' THEN 'deleted' ELSE 'active' END
  AND actor.household_id=NEW.household_id AND actor.role='owner' AND actor.state='active'
  AND ctx.entry_id=NEW.entry_id AND ctx.actor_user_id=NEW.owner_user_id
  AND ctx.expected_version=NEW.version_before AND ctx.action=NEW.action
  AND COALESCE(card.requester_user_id,prepaid.requester_user_id)=NEW.spender_user_id
  AND COALESCE(card.household_id,prepaid.household_id)=NEW.household_id
  AND acct.owner_user_id=NEW.spender_user_id AND acct.household_id=NEW.household_id
  AND acct.account_kind IN ('credit_card','prepaid') AND acct.origin='member_created'
  AND acct.is_archived=0 AND e.type='expense'
  AND json_extract(NEW.before_json,'$.type')='expense'
  AND json_extract(NEW.after_json,'$.type')='expense'
  AND json_extract(NEW.before_json,'$.amount')=e.amount
  AND json_extract(NEW.before_json,'$.date')=e.date
  AND json_extract(NEW.before_json,'$.accountId') IS e.family_account_id
  AND json_extract(NEW.after_json,'$.accountId') IS e.family_account_id
  AND CAST(json_extract(NEW.after_json,'$.amount') AS INTEGER) BETWEEN 0 AND 10000000
  AND (NEW.action='update' AND e.amount>0 AND json_extract(NEW.after_json,'$.amount')>0
   OR NEW.action='delete' AND e.amount>0 AND json_extract(NEW.after_json,'$.amount')=0
   OR NEW.action='restore' AND e.amount=0 AND json_extract(NEW.after_json,'$.amount')>0)
 )
 BEGIN SELECT RAISE(ABORT,'OWNER_ACCOUNT_CORRECTION_CAS_OR_ORIGIN_INVALID'); END;
CREATE TRIGGER IF NOT EXISTS trg_owner_account_correction_no_update
 BEFORE UPDATE ON family_owner_account_corrections BEGIN
 SELECT RAISE(ABORT,'OWNER_ACCOUNT_CORRECTION_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_owner_account_correction_no_delete
 BEFORE DELETE ON family_owner_account_corrections BEGIN
 SELECT RAISE(ABORT,'OWNER_ACCOUNT_CORRECTION_IMMUTABLE'); END;
CREATE TABLE IF NOT EXISTS family_owner_account_effects (
 correction_id TEXT NOT NULL REFERENCES family_owner_account_corrections(correction_id) ON DELETE RESTRICT,
 household_id TEXT NOT NULL,
 account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 account_kind TEXT NOT NULL CHECK(account_kind IN ('credit_card','prepaid')),
 bill_month TEXT NOT NULL CHECK(bill_month='' OR length(bill_month)=7),
 delta_jpy INTEGER NOT NULL CHECK(delta_jpy<>0 AND ABS(delta_jpy)<=20000000),
 purchase_count_delta INTEGER NOT NULL DEFAULT 0 CHECK(purchase_count_delta BETWEEN -1 AND 1),
 created_at INTEGER NOT NULL CHECK(created_at>0),
 PRIMARY KEY(correction_id,account_id,account_kind,bill_month)
);
CREATE INDEX IF NOT EXISTS idx_owner_account_effects_account
 ON family_owner_account_effects(household_id,account_id,bill_month);
CREATE TRIGGER IF NOT EXISTS trg_owner_account_effect_guard
 BEFORE INSERT ON family_owner_account_effects
 WHEN NOT EXISTS (
 SELECT 1 FROM family_owner_account_corrections c
 JOIN family_financial_accounts a ON a.account_id=NEW.account_id
 WHERE c.correction_id=NEW.correction_id AND c.household_id=NEW.household_id
  AND a.household_id=c.household_id AND a.owner_user_id=c.spender_user_id
  AND a.origin='member_created' AND a.is_archived=0
  AND a.account_kind=NEW.account_kind
  AND (NEW.account_kind='prepaid' AND NEW.bill_month='' AND NEW.purchase_count_delta=0
   OR NEW.account_kind='credit_card' AND length(NEW.bill_month)=7)
 )
 BEGIN SELECT RAISE(ABORT,'OWNER_ACCOUNT_EFFECT_SCOPE_INVALID'); END;
CREATE TRIGGER IF NOT EXISTS trg_owner_account_effect_no_update
 BEFORE UPDATE ON family_owner_account_effects BEGIN
 SELECT RAISE(ABORT,'OWNER_ACCOUNT_EFFECT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_owner_account_effect_no_delete
 BEFORE DELETE ON family_owner_account_effects BEGIN
 SELECT RAISE(ABORT,'OWNER_ACCOUNT_EFFECT_IMMUTABLE'); END;

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
  OR (OLD.state='active' AND NEW.state='deleted' AND c.action='delete'
   AND EXISTS(SELECT 1 FROM entries e JOIN family_owner_account_corrections correction
    ON correction.entry_id=e.id
    WHERE e.id=OLD.entry_id AND e.type='expense' AND e.amount=0
    AND correction.resource_id=OLD.resource_id
    AND correction.version_before=OLD.version AND correction.version_after=NEW.version
    AND correction.owner_user_id=c.actor_user_id AND correction.action='delete'))
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
 AND json_extract(correction.before_json,'$.accountId') IS OLD.family_account_id
 AND json_extract(correction.after_json,'$.amount')=NEW.amount
 AND json_extract(correction.after_json,'$.date')=NEW.date
 AND json_extract(correction.after_json,'$.accountId') IS NEW.family_account_id
 )
 AND NOT EXISTS (
 SELECT 1 FROM family_owner_account_corrections correction
 JOIN family_shared_entry_registry registry ON registry.entry_id=correction.entry_id
 JOIN family_shared_entry_write_context context ON context.resource_id=registry.resource_id
 WHERE correction.entry_id=OLD.id
  AND correction.resource_id=registry.resource_id
  AND correction.version_before=registry.version
  AND correction.version_after=registry.version+1
  AND context.entry_id=OLD.id AND context.expected_version=registry.version
  AND context.action=correction.action
  AND context.actor_user_id=correction.owner_user_id
  AND OLD.type='expense' AND NEW.type='expense'
  AND OLD.client_request_id IS NEW.client_request_id
  AND OLD.family_transfer_target_account_id IS NEW.family_transfer_target_account_id
  AND json_extract(correction.before_json,'$.amount')=OLD.amount
  AND json_extract(correction.before_json,'$.date')=OLD.date
  AND json_extract(correction.before_json,'$.accountId') IS OLD.family_account_id
  AND json_extract(correction.after_json,'$.amount')=NEW.amount
  AND json_extract(correction.after_json,'$.date')=NEW.date
  AND json_extract(correction.after_json,'$.accountId') IS NEW.family_account_id
  AND OLD.payment_source=NEW.payment_source
  AND OLD.family_account_id IS NEW.family_account_id
 )
 BEGIN SELECT RAISE(ABORT,'PREPAID_ENTRY_IMMUTABLE'); END;
-- Authorized future-paid delete/restore uses a zero-value physical
-- tombstone, not DELETE or INSERT: the original immutable purchase references
-- entries.id via a RESTRICT foreign key. Never relax owner-approved UPDATE.

DROP TRIGGER IF EXISTS trg_family_card_purchase_entry_no_update;
CREATE TRIGGER trg_family_card_purchase_entry_no_update
 BEFORE UPDATE ON entries
 WHEN EXISTS(SELECT 1 FROM family_card_purchase_applied p WHERE p.entry_id=OLD.id)
 AND NOT EXISTS (
  SELECT 1 FROM family_approved_account_corrections correction
  JOIN family_shared_entry_registry registry ON registry.entry_id=correction.entry_id
  JOIN family_shared_entry_write_context context ON context.resource_id=registry.resource_id
  JOIN family_card_purchase_applied original ON original.entry_id=correction.entry_id
  WHERE correction.entry_id=OLD.id
   AND original.household_id=correction.household_id
   AND correction.spender_user_id=original.requester_user_id
   AND OLD.client_request_id='hfcard:'||original.homeflow_request_id
   AND NEW.client_request_id=OLD.client_request_id
   AND OLD.type='expense' AND NEW.type='expense'
   AND NEW.family_transfer_target_account_id IS NULL
   AND registry.version=correction.version_before
   AND correction.version_after=registry.version+1
   AND context.entry_id=OLD.id AND context.expected_version=registry.version
   AND context.action IN ('update','delete','restore')
   AND context.actor_user_id=correction.approver_user_id
   AND json_extract(correction.before_json,'$.amount')=OLD.amount
   AND json_extract(correction.before_json,'$.date')=OLD.date
   AND json_extract(correction.before_json,'$.accountId') IS OLD.family_account_id
   AND json_extract(correction.after_json,'$.amount')=NEW.amount
   AND json_extract(correction.after_json,'$.date')=NEW.date
   AND json_extract(correction.after_json,'$.accountId') IS NEW.family_account_id
   AND NEW.payment_source=CASE WHEN NEW.family_account_id IS NULL THEN ''
    ELSE (SELECT CASE WHEN a.account_kind='credit_card' THEN 'cc:'
                      WHEN a.account_kind='prepaid' THEN 'prepaid:'
                      ELSE 'invalid:' END||a.account_id
          FROM family_financial_accounts a
          WHERE a.account_id=NEW.family_account_id AND a.household_id=correction.household_id
            AND a.owner_user_id=correction.spender_user_id)
    END
 )
 AND NOT EXISTS (
 SELECT 1 FROM family_owner_account_corrections correction
 JOIN family_shared_entry_registry registry ON registry.entry_id=correction.entry_id
 JOIN family_shared_entry_write_context context ON context.resource_id=registry.resource_id
 WHERE correction.entry_id=OLD.id
  AND correction.resource_id=registry.resource_id
  AND correction.version_before=registry.version
  AND correction.version_after=registry.version+1
  AND context.entry_id=OLD.id AND context.expected_version=registry.version
  AND context.action=correction.action
  AND context.actor_user_id=correction.owner_user_id
  AND OLD.type='expense' AND NEW.type='expense'
  AND OLD.client_request_id IS NEW.client_request_id
  AND OLD.family_transfer_target_account_id IS NEW.family_transfer_target_account_id
  AND json_extract(correction.before_json,'$.amount')=OLD.amount
  AND json_extract(correction.before_json,'$.date')=OLD.date
  AND json_extract(correction.before_json,'$.accountId') IS OLD.family_account_id
  AND json_extract(correction.after_json,'$.amount')=NEW.amount
  AND json_extract(correction.after_json,'$.date')=NEW.date
  AND json_extract(correction.after_json,'$.accountId') IS NEW.family_account_id
  AND OLD.payment_source=NEW.payment_source
  AND OLD.family_account_id IS NEW.family_account_id
 )
 BEGIN SELECT RAISE(ABORT,'CARD_PURCHASE_ENTRY_IMMUTABLE'); END;

DROP TRIGGER IF EXISTS trg_shared_entry_guard_update;
CREATE TRIGGER trg_shared_entry_guard_update BEFORE UPDATE ON entries
WHEN EXISTS(SELECT 1 FROM family_shared_entry_registry r WHERE r.entry_id=OLD.id)
AND NOT EXISTS (
 SELECT 1 FROM family_shared_entry_write_context c
 JOIN family_shared_entry_registry r ON r.resource_id=c.resource_id
 WHERE c.entry_id=OLD.id AND r.entry_id=OLD.id AND c.expected_version=r.version
  AND (
    c.action='update'
    OR (c.action IN ('delete','restore') AND (
      EXISTS(SELECT 1 FROM family_approved_account_corrections correction
        WHERE correction.entry_id=OLD.id AND correction.version_before=r.version
         AND correction.version_after=r.version+1
         AND correction.approver_user_id=c.actor_user_id
         AND json_extract(correction.before_json,'$.amount')=OLD.amount
         AND json_extract(correction.after_json,'$.amount')=NEW.amount
         AND json_extract(correction.before_json,'$.date')=OLD.date
         AND json_extract(correction.after_json,'$.date')=NEW.date
         AND json_extract(correction.before_json,'$.accountId') IS OLD.family_account_id
         AND json_extract(correction.after_json,'$.accountId') IS NEW.family_account_id)
      OR EXISTS(SELECT 1 FROM family_owner_account_corrections correction
        WHERE correction.entry_id=OLD.id AND correction.resource_id=r.resource_id
         AND correction.version_before=r.version AND correction.version_after=r.version+1
         AND correction.owner_user_id=c.actor_user_id AND correction.action=c.action
         AND json_extract(correction.before_json,'$.amount')=OLD.amount
         AND json_extract(correction.after_json,'$.amount')=NEW.amount
         AND json_extract(correction.before_json,'$.date')=OLD.date
         AND json_extract(correction.after_json,'$.date')=NEW.date
         AND json_extract(correction.before_json,'$.accountId') IS OLD.family_account_id
         AND json_extract(correction.after_json,'$.accountId') IS NEW.family_account_id)
    ))
  )
)
BEGIN SELECT RAISE(ABORT,'SHARED_ENTRY_APPROVAL_CONTEXT_REQUIRED'); END;
INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(
 'schema-0106-owner-account-correction-journal',
 'Owner-only account-linked household edits with guarded private spender ownership and immutable audit effects');
