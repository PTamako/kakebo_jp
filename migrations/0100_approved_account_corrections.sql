-- 0100: Future-only approved correction journal for MEMBER-CREATED credit
-- and prepaid purchases. Immutable original purchase/charge/points evidence
-- remains unchanged. No historical replay, no default-enabled writer.
-- Every new effect is signed by an authorized HomeFlow entry.update workflow;
-- the executor must write correction, effects and final ledger update in one
-- atomic D1 transaction, never as independent browser operations.
CREATE TABLE IF NOT EXISTS family_approved_account_corrections (
 homeflow_request_id TEXT PRIMARY KEY NOT NULL CHECK(length(homeflow_request_id)=36),
 proposal_id TEXT NOT NULL UNIQUE REFERENCES family_shared_mutation_intents(proposal_id) ON DELETE RESTRICT,
 household_id TEXT NOT NULL,
 entry_id INTEGER NOT NULL REFERENCES entries(id) ON DELETE RESTRICT,
 spender_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 requester_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 approver_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 version_before INTEGER NOT NULL CHECK(version_before>=1),
 version_after INTEGER NOT NULL CHECK(version_after=version_before+1),
 before_json TEXT NOT NULL CHECK(json_valid(before_json)),
 after_json TEXT NOT NULL CHECK(json_valid(after_json)),
 created_at INTEGER NOT NULL CHECK(created_at>0),
 CHECK(requester_user_id<>approver_user_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_correction_entry_version
 ON family_approved_account_corrections(entry_id,version_after);
CREATE TRIGGER IF NOT EXISTS trg_account_correction_approved_source
 BEFORE INSERT ON family_approved_account_corrections
 WHEN NOT EXISTS(
  SELECT 1 FROM family_shared_mutation_intents intent
  JOIN family_shared_entry_registry registry
   ON registry.resource_id=intent.resource_id
  JOIN entries entry ON entry.id=registry.entry_id
  JOIN homeflow_identity_links requester ON requester.user_id=intent.requester_user_id
  JOIN homeflow_identity_links approver ON approver.user_id=NEW.approver_user_id
  LEFT JOIN family_card_purchase_applied card ON card.entry_id=entry.id
  LEFT JOIN family_prepaid_actions_applied prepaid ON prepaid.entry_id=entry.id AND prepaid.action='spend'
  WHERE intent.proposal_id=NEW.proposal_id
   AND intent.status='submitted' AND intent.operation IN('update','delete','restore')
   AND intent.homeflow_approval_id=NEW.homeflow_request_id
   AND intent.household_id=NEW.household_id
   AND intent.requester_user_id=NEW.requester_user_id
   AND intent.expected_version=NEW.version_before
   AND registry.household_id=NEW.household_id
   AND registry.entry_id=NEW.entry_id
   AND registry.version=NEW.version_before
   AND registry.state=CASE WHEN intent.operation='restore' THEN 'deleted' ELSE 'active' END
   AND entry.type='expense'
   AND COALESCE(card.requester_user_id,prepaid.requester_user_id)=NEW.spender_user_id
   AND COALESCE(card.household_id,prepaid.household_id)=NEW.household_id
   AND requester.household_id=NEW.household_id AND requester.role='member' AND requester.state='active'
   AND approver.household_id=NEW.household_id AND approver.role='owner' AND approver.state='active'
   AND json_extract(NEW.before_json,'$.type')='expense'
   AND json_extract(NEW.before_json,'$.amount')=entry.amount
   AND json_extract(NEW.before_json,'$.date')=entry.date
   AND json_extract(NEW.before_json,'$.accountId')=entry.family_account_id
   AND json_extract(NEW.after_json,'$.type')='expense'
   AND CAST(json_extract(NEW.after_json,'$.amount') AS INTEGER) BETWEEN 0 AND 10000000
   AND (
    (intent.operation='update' AND entry.amount>0 AND json_extract(NEW.after_json,'$.amount')>0)
    OR (intent.operation='delete' AND entry.amount>0 AND json_extract(NEW.after_json,'$.amount')=0)
    OR (intent.operation='restore' AND entry.amount=0 AND json_extract(NEW.after_json,'$.amount')>0)
   )
 )
 BEGIN SELECT RAISE(ABORT,'ACCOUNT_CORRECTION_APPROVAL_OR_SNAPSHOT_INVALID'); END;
CREATE TRIGGER IF NOT EXISTS trg_account_correction_no_update
 BEFORE UPDATE ON family_approved_account_corrections
 BEGIN SELECT RAISE(ABORT,'ACCOUNT_CORRECTION_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_account_correction_no_delete
 BEFORE DELETE ON family_approved_account_corrections
 BEGIN SELECT RAISE(ABORT,'ACCOUNT_CORRECTION_IMMUTABLE'); END;
-- bill_month='' for prepaid and YYYY-MM for credit_card, so key is never NULL.
CREATE TABLE IF NOT EXISTS family_approved_account_effects (
 homeflow_request_id TEXT NOT NULL REFERENCES family_approved_account_corrections(homeflow_request_id) ON DELETE RESTRICT,
 household_id TEXT NOT NULL,
 account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 account_kind TEXT NOT NULL CHECK(account_kind IN ('credit_card','prepaid')),
 bill_month TEXT NOT NULL DEFAULT '' CHECK(bill_month='' OR (length(bill_month)=7 AND substr(bill_month,5,1)='-')),
 delta_jpy INTEGER NOT NULL CHECK(delta_jpy<>0 AND abs(delta_jpy)<=20000000),
 purchase_count_delta INTEGER NOT NULL DEFAULT 0 CHECK(purchase_count_delta BETWEEN -1 AND 1),
 created_at INTEGER NOT NULL CHECK(created_at>0),
 PRIMARY KEY(homeflow_request_id,account_id,account_kind,bill_month),
 CHECK((account_kind='prepaid' AND bill_month='' AND purchase_count_delta=0)
 OR (account_kind='credit_card' AND length(bill_month)=7))
);
CREATE INDEX IF NOT EXISTS idx_approved_account_effects_balance
 ON family_approved_account_effects(household_id,account_id,bill_month);
CREATE TRIGGER IF NOT EXISTS trg_approved_account_effect_owner
 BEFORE INSERT ON family_approved_account_effects
 WHEN NOT EXISTS (
  SELECT 1 FROM family_approved_account_corrections c
  JOIN family_financial_accounts a ON a.account_id=NEW.account_id
  WHERE c.homeflow_request_id=NEW.homeflow_request_id
  AND c.household_id=NEW.household_id
  AND a.household_id=NEW.household_id AND a.owner_user_id=c.spender_user_id
  AND a.account_kind=NEW.account_kind AND a.origin='member_created'
  AND a.is_archived=0)
 BEGIN SELECT RAISE(ABORT,'ACCOUNT_EFFECT_OWNER_MISMATCH'); END;
CREATE TRIGGER IF NOT EXISTS trg_approved_account_effect_no_update
 BEFORE UPDATE ON family_approved_account_effects
 BEGIN SELECT RAISE(ABORT,'ACCOUNT_EFFECT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_approved_account_effect_no_delete
 BEFORE DELETE ON family_approved_account_effects
 BEGIN SELECT RAISE(ABORT,'ACCOUNT_EFFECT_IMMUTABLE'); END;
INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(
 'schema-0100-approved-account-corrections',
 'Future-only approved credit/prepaid expense amendment and signed immutable balance/liability effects; execution disabled until audited HomeFlow route ships');
