-- 0033 (Draft P0-4): NEW member-created prepaid account balance journal.
-- Not a migration for pre-existing legacy Suica/PASMO balances; those stay untouched.
-- Top-up is a bank→prepaid TRANSFER, spend is one EXPENSE; never both.
CREATE TABLE IF NOT EXISTS family_prepaid_action_intents (
 request_id TEXT PRIMARY KEY CHECK(length(request_id)=32),
 household_id TEXT NOT NULL,
 requester_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 prepaid_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 prepaid_version INTEGER NOT NULL CHECK(prepaid_version>=1),
 action TEXT NOT NULL CHECK(action IN ('topup','spend')),
 bank_account_id TEXT REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 bank_version INTEGER CHECK(bank_version IS NULL OR bank_version>=1),
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 payload_cipher TEXT NOT NULL,
 payload_iv TEXT NOT NULL,
 idempotency_hash TEXT NOT NULL UNIQUE CHECK(length(idempotency_hash)=64),
 status TEXT NOT NULL CHECK(status IN ('prepared','submitted','cancelled')),
 homeflow_approval_id TEXT UNIQUE,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL CHECK(expires_at>created_at),
 submitted_at INTEGER,
 CHECK((action='topup' AND bank_account_id IS NOT NULL AND bank_version IS NOT NULL
  AND prepaid_account_id<>bank_account_id)
  OR (action='spend' AND bank_account_id IS NULL AND bank_version IS NULL)),
 CHECK((status='prepared' AND homeflow_approval_id IS NULL AND submitted_at IS NULL)
  OR (status='submitted' AND length(homeflow_approval_id)=36 AND submitted_at>0)
  OR (status='cancelled' AND homeflow_approval_id IS NULL AND submitted_at IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_family_prepaid_intents_member
 ON family_prepaid_action_intents(household_id,requester_user_id,created_at DESC);
CREATE TRIGGER IF NOT EXISTS trg_family_prepaid_intent_owner
 BEFORE INSERT ON family_prepaid_action_intents
 WHEN NOT EXISTS (
 SELECT 1 FROM family_financial_accounts prepaid
 JOIN homeflow_identity_links actor ON actor.user_id=NEW.requester_user_id
 WHERE prepaid.account_id=NEW.prepaid_account_id
 AND prepaid.household_id=NEW.household_id
 AND prepaid.owner_user_id=NEW.requester_user_id
 AND prepaid.account_kind='prepaid' AND prepaid.origin='member_created'
 AND prepaid.version=NEW.prepaid_version AND prepaid.is_archived=0
 AND actor.household_id=NEW.household_id AND actor.role='member'
 AND actor.state='active'
 AND (NEW.action='spend' OR EXISTS(
  SELECT 1 FROM family_financial_accounts bank
  WHERE bank.account_id=NEW.bank_account_id
  AND bank.household_id=NEW.household_id
  AND bank.owner_user_id=NEW.requester_user_id
  AND bank.account_kind='bank' AND bank.origin='member_created'
  AND bank.version=NEW.bank_version AND bank.is_archived=0)))
 BEGIN SELECT RAISE(ABORT,'PREPAID_ACCOUNT_OWNER_OR_VERSION'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_prepaid_intent_no_identity_edit
 BEFORE UPDATE OF request_id,household_id,requester_user_id,prepaid_account_id,
 prepaid_version,action,bank_account_id,bank_version,payload_sha256,payload_cipher,payload_iv,
 idempotency_hash,created_at,expires_at ON family_prepaid_action_intents
 BEGIN SELECT RAISE(ABORT,'PREPAID_INTENT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_prepaid_intent_status
 BEFORE UPDATE ON family_prepaid_action_intents
 WHEN NOT(OLD.status='prepared' AND NEW.status IN ('submitted','cancelled'))
 BEGIN SELECT RAISE(ABORT,'PREPAID_INTENT_STATE_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_prepaid_intent_no_delete
 BEFORE DELETE ON family_prepaid_action_intents
 BEGIN SELECT RAISE(ABORT,'PREPAID_INTENT_IMMUTABLE'); END;

-- Bank reference may only be present for an actual user-confirmed top-up.
-- UNIQUE(bank_account_id,bank_reference_hash) is a one-use debit proof.
CREATE TABLE IF NOT EXISTS family_prepaid_actions_applied (
 homeflow_request_id TEXT PRIMARY KEY CHECK(length(homeflow_request_id)=36),
 proposal_id TEXT NOT NULL UNIQUE REFERENCES family_prepaid_action_intents(request_id) ON DELETE RESTRICT,
 household_id TEXT NOT NULL,
 requester_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 approver_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 actor_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 prepaid_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 prepaid_version INTEGER NOT NULL CHECK(prepaid_version>=1),
 action TEXT NOT NULL CHECK(action IN ('topup','spend')),
 bank_account_id TEXT REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 bank_version INTEGER,
 bank_reference_hash TEXT CHECK(bank_reference_hash IS NULL OR length(bank_reference_hash)=64),
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 entry_id INTEGER NOT NULL UNIQUE REFERENCES entries(id) ON DELETE RESTRICT,
 amount_jpy INTEGER NOT NULL CHECK(amount_jpy BETWEEN 1 AND 10000000),
 date TEXT NOT NULL CHECK(length(date)=10),
 balance_after_jpy INTEGER NOT NULL CHECK(balance_after_jpy BETWEEN 0 AND 100000000),
 applied_at INTEGER NOT NULL CHECK(applied_at>0),
 UNIQUE(bank_account_id,bank_reference_hash),
 CHECK((action='topup' AND bank_account_id IS NOT NULL AND bank_version>=1
  AND bank_reference_hash IS NOT NULL)
  OR (action='spend' AND bank_account_id IS NULL AND bank_version IS NULL
  AND bank_reference_hash IS NULL)),
 CHECK(approver_user_id<>requester_user_id),
 CHECK(actor_user_id=approver_user_id)
);
CREATE INDEX IF NOT EXISTS idx_family_prepaid_applied_account_date
 ON family_prepaid_actions_applied(household_id,prepaid_account_id,date);
CREATE TRIGGER IF NOT EXISTS trg_family_prepaid_applied_validate
 BEFORE INSERT ON family_prepaid_actions_applied
 WHEN NOT EXISTS (
 SELECT 1 FROM family_prepaid_action_intents p
 JOIN family_financial_accounts prepaid ON prepaid.account_id=p.prepaid_account_id
 JOIN homeflow_identity_links requester ON requester.user_id=p.requester_user_id
 JOIN homeflow_identity_links approver ON approver.user_id=NEW.approver_user_id
 JOIN entries e ON e.id=NEW.entry_id
 WHERE p.request_id=NEW.proposal_id AND p.status='submitted'
 AND p.homeflow_approval_id=NEW.homeflow_request_id
 AND p.household_id=NEW.household_id AND p.requester_user_id=NEW.requester_user_id
 AND p.payload_sha256=NEW.payload_sha256
 AND p.prepaid_account_id=NEW.prepaid_account_id
 AND p.prepaid_version=NEW.prepaid_version AND p.action=NEW.action
 AND p.bank_account_id IS NEW.bank_account_id AND p.bank_version IS NEW.bank_version
 AND prepaid.household_id=NEW.household_id AND prepaid.owner_user_id=NEW.requester_user_id
 AND prepaid.account_kind='prepaid' AND prepaid.origin='member_created'
 AND prepaid.version=NEW.prepaid_version AND prepaid.is_archived=0
 AND requester.household_id=NEW.household_id AND requester.role='member'
 AND requester.state='active'
 AND approver.household_id=NEW.household_id AND approver.role='owner'
 AND approver.state='active'
 AND (NEW.action='spend' OR EXISTS(
  SELECT 1 FROM family_financial_accounts bank
  WHERE bank.account_id=NEW.bank_account_id
  AND bank.household_id=NEW.household_id
  AND bank.owner_user_id=NEW.requester_user_id
  AND bank.account_kind='bank' AND bank.origin='member_created'
  AND bank.version=NEW.bank_version AND bank.is_archived=0))
 AND e.date=NEW.date AND e.amount=NEW.amount_jpy
 AND e.client_request_id='hfprepaid:'||NEW.homeflow_request_id
 AND ((NEW.action='topup' AND e.type='transfer'
  AND e.family_account_id=NEW.bank_account_id
  AND e.family_transfer_target_account_id=NEW.prepaid_account_id
  AND e.payment_source='bank:'||NEW.bank_account_id
  AND e.transfer_target='prepaid:'||NEW.prepaid_account_id
  AND e.transfer_applied=1 AND e.transfer_date=NEW.date)
  OR (NEW.action='spend' AND e.type='expense'
  AND e.family_account_id=NEW.prepaid_account_id
  AND e.family_transfer_target_account_id IS NULL
  AND e.payment_source='prepaid:'||NEW.prepaid_account_id))
 )
 BEGIN SELECT RAISE(ABORT,'PREPAID_ENTRY_OR_ACCOUNT_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_prepaid_applied_no_update
 BEFORE UPDATE ON family_prepaid_actions_applied
 BEGIN SELECT RAISE(ABORT,'PREPAID_APPLIED_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_prepaid_applied_no_delete
 BEFORE DELETE ON family_prepaid_actions_applied
 BEGIN SELECT RAISE(ABORT,'PREPAID_APPLIED_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_prepaid_applied_entry_no_update
 BEFORE UPDATE ON entries
 WHEN EXISTS(SELECT 1 FROM family_prepaid_actions_applied a WHERE a.entry_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'PREPAID_ENTRY_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_prepaid_applied_entry_no_delete
 BEFORE DELETE ON entries
 WHEN EXISTS(SELECT 1 FROM family_prepaid_actions_applied a WHERE a.entry_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'PREPAID_ENTRY_IMMUTABLE'); END;

-- Serialized SQLite writer transaction prevents concurrent overdrafts.
-- All journal rows are immutable; historical starting balance is ZERO here.
-- Legacy prepaid balances require a separately approved ownership mapping.
CREATE TABLE IF NOT EXISTS family_prepaid_balance_journal (
 homeflow_request_id TEXT PRIMARY KEY REFERENCES family_prepaid_actions_applied(homeflow_request_id) ON DELETE RESTRICT,
 household_id TEXT NOT NULL,
 prepaid_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 delta_jpy INTEGER NOT NULL CHECK(delta_jpy<>0 AND abs(delta_jpy)<=10000000),
 balance_after_jpy INTEGER NOT NULL CHECK(balance_after_jpy BETWEEN 0 AND 100000000),
 effective_date TEXT NOT NULL CHECK(length(effective_date)=10),
 created_at INTEGER NOT NULL CHECK(created_at>0)
);
CREATE INDEX IF NOT EXISTS idx_family_prepaid_balance_account
 ON family_prepaid_balance_journal(household_id,prepaid_account_id,created_at);
CREATE TRIGGER IF NOT EXISTS trg_family_prepaid_balance_atomic
 BEFORE INSERT ON family_prepaid_balance_journal
 WHEN NOT EXISTS(
  SELECT 1 FROM family_prepaid_actions_applied a
  WHERE a.homeflow_request_id=NEW.homeflow_request_id
  AND a.household_id=NEW.household_id
  AND a.prepaid_account_id=NEW.prepaid_account_id
  AND a.date=NEW.effective_date
  AND a.balance_after_jpy=NEW.balance_after_jpy
  AND NEW.delta_jpy=CASE WHEN a.action='topup' THEN a.amount_jpy ELSE -a.amount_jpy END
  AND NEW.balance_after_jpy=COALESCE((
   SELECT SUM(j.delta_jpy) FROM family_prepaid_balance_journal j
   WHERE j.prepaid_account_id=NEW.prepaid_account_id),0)+NEW.delta_jpy
  AND NEW.balance_after_jpy>=0
 )
 BEGIN SELECT RAISE(ABORT,'PREPAID_OVERDRAFT_OR_CONCURRENT_BALANCE'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_prepaid_balance_no_update
 BEFORE UPDATE ON family_prepaid_balance_journal
 BEGIN SELECT RAISE(ABORT,'PREPAID_BALANCE_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_prepaid_balance_no_delete
 BEFORE DELETE ON family_prepaid_balance_journal
 BEGIN SELECT RAISE(ABORT,'PREPAID_BALANCE_IMMUTABLE'); END;

CREATE TABLE IF NOT EXISTS family_prepaid_action_audit (
 event_id TEXT PRIMARY KEY,
 homeflow_request_id TEXT NOT NULL UNIQUE REFERENCES family_prepaid_actions_applied(homeflow_request_id) ON DELETE RESTRICT,
 requester_user_id TEXT NOT NULL,
 approver_user_id TEXT NOT NULL,
 actor_user_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action IN ('prepaid_topup_applied','prepaid_spend_applied')),
 created_at INTEGER NOT NULL CHECK(created_at>0)
);
CREATE TRIGGER IF NOT EXISTS trg_family_prepaid_audit_valid
 BEFORE INSERT ON family_prepaid_action_audit
 WHEN NOT EXISTS (
 SELECT 1 FROM family_prepaid_actions_applied a
 JOIN family_prepaid_balance_journal j ON j.homeflow_request_id=a.homeflow_request_id
 WHERE a.homeflow_request_id=NEW.homeflow_request_id
 AND a.requester_user_id=NEW.requester_user_id
 AND a.approver_user_id=NEW.approver_user_id
 AND a.actor_user_id=NEW.actor_user_id
 AND NEW.action=CASE WHEN a.action='topup' THEN 'prepaid_topup_applied'
  ELSE 'prepaid_spend_applied' END
 AND j.prepaid_account_id=a.prepaid_account_id
 AND j.balance_after_jpy=a.balance_after_jpy)
 BEGIN SELECT RAISE(ABORT,'PREPAID_AUDIT_OR_BALANCE_MISSING'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_prepaid_audit_no_update
 BEFORE UPDATE ON family_prepaid_action_audit
 BEGIN SELECT RAISE(ABORT,'PREPAID_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_prepaid_audit_no_delete
 BEFORE DELETE ON family_prepaid_action_audit
 BEGIN SELECT RAISE(ABORT,'PREPAID_AUDIT_IMMUTABLE'); END;
INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(
 'schema-0033-member-prepaid-actions',
 'Draft member-created prepaid bank topup and spending with nonnegative immutable balance journal');
