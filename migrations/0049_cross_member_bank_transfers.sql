-- 0049 DRAFT: cross-member posted-bank transfer. One Kakeibo D1; no banking API.
-- Existing 0048 SAME OWNER guards remain untouched. Nothing here makes a bank transfer.
CREATE TABLE IF NOT EXISTS family_cross_bank_intents(
 request_id TEXT PRIMARY KEY CHECK(length(request_id)=32),
 household_id TEXT NOT NULL,
 requester_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 recipient_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 source_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 source_version INTEGER NOT NULL CHECK(source_version>=1),
 target_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 target_version INTEGER NOT NULL CHECK(target_version>=1),
 amount_jpy INTEGER NOT NULL CHECK(amount_jpy BETWEEN 1 AND 10000000),
 debit_date TEXT NOT NULL CHECK(length(debit_date)=10),
 source_reference_hash TEXT NOT NULL CHECK(length(source_reference_hash)=64),
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 payload_cipher TEXT NOT NULL,payload_iv TEXT NOT NULL,
 idempotency_hash TEXT NOT NULL UNIQUE CHECK(length(idempotency_hash)=64),
 status TEXT NOT NULL DEFAULT 'prepared' CHECK(status IN('prepared','submitted','cancelled')),
 consent_id TEXT UNIQUE CHECK(consent_id IS NULL OR length(consent_id)=36),
 homeflow_approval_id TEXT UNIQUE CHECK(homeflow_approval_id IS NULL OR length(homeflow_approval_id)=36),
 created_at INTEGER NOT NULL CHECK(created_at>0),
 expires_at INTEGER NOT NULL CHECK(expires_at>created_at),
 submitted_at INTEGER,
 CHECK(requester_user_id<>recipient_user_id AND source_account_id<>target_account_id),
 CHECK((status='prepared' AND consent_id IS NULL AND homeflow_approval_id IS NULL)
 OR (status='submitted' AND consent_id IS NOT NULL AND homeflow_approval_id IS NOT NULL)
 OR status='cancelled')
);
CREATE INDEX IF NOT EXISTS idx_cross_bank_intent_household
 ON family_cross_bank_intents(household_id,requester_user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_cross_bank_intent_recipient
 ON family_cross_bank_intents(household_id,recipient_user_id,created_at DESC);
CREATE TRIGGER IF NOT EXISTS trg_cross_bank_intent_guard BEFORE INSERT ON family_cross_bank_intents
WHEN NOT EXISTS(
 SELECT 1 FROM homeflow_identity_links sender
 JOIN homeflow_identity_links recipient
  ON recipient.user_id=NEW.recipient_user_id AND recipient.household_id=sender.household_id
 JOIN family_financial_accounts src
  ON src.account_id=NEW.source_account_id
 JOIN family_financial_accounts dst
  ON dst.account_id=NEW.target_account_id
 WHERE sender.user_id=NEW.requester_user_id AND sender.household_id=NEW.household_id
 AND sender.state='active' AND sender.role='member'
 AND recipient.state='active' AND recipient.role='owner'
 AND src.household_id=NEW.household_id AND dst.household_id=NEW.household_id
 AND src.owner_user_id=NEW.requester_user_id AND dst.owner_user_id=NEW.recipient_user_id
 AND src.version=NEW.source_version AND dst.version=NEW.target_version
 AND src.origin='member_created' AND dst.origin='member_created'
 AND src.account_kind='bank' AND dst.account_kind='bank'
 AND src.is_archived=0 AND dst.is_archived=0
) BEGIN SELECT RAISE(ABORT,'CROSS_BANK_OWNER_OR_CAS'); END;
CREATE TRIGGER IF NOT EXISTS trg_cross_bank_intent_immutable BEFORE UPDATE OF
 request_id,household_id,requester_user_id,recipient_user_id,source_account_id,
 source_version,target_account_id,target_version,amount_jpy,debit_date,
 source_reference_hash,payload_sha256,payload_cipher,payload_iv,idempotency_hash,
 created_at,expires_at
ON family_cross_bank_intents
BEGIN SELECT RAISE(ABORT,'CROSS_BANK_INTENT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_cross_bank_intent_status BEFORE UPDATE ON family_cross_bank_intents
WHEN NOT (
 OLD.status='prepared' AND NEW.status='cancelled' AND NEW.consent_id IS NULL AND NEW.homeflow_approval_id IS NULL
 OR OLD.status='prepared' AND NEW.status='submitted' AND NEW.consent_id IS NOT NULL
 AND NEW.homeflow_approval_id IS NOT NULL AND NEW.submitted_at IS NOT NULL
)
BEGIN SELECT RAISE(ABORT,'CROSS_BANK_STATE_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_cross_bank_intent_delete BEFORE DELETE ON family_cross_bank_intents
BEGIN SELECT RAISE(ABORT,'CROSS_BANK_INTENT_IMMUTABLE'); END;

-- Recipient uses own SSO and actually attests its OWN posted credit evidence.
CREATE TABLE IF NOT EXISTS family_cross_bank_recipient_evidence(
 request_id TEXT PRIMARY KEY REFERENCES family_cross_bank_intents(request_id) ON DELETE RESTRICT,
 household_id TEXT NOT NULL,
 recipient_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 target_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 target_version INTEGER NOT NULL CHECK(target_version>=1),
 credit_reference_hash TEXT NOT NULL CHECK(length(credit_reference_hash)=64),
 credit_date TEXT NOT NULL CHECK(length(credit_date)=10),
 amount_jpy INTEGER NOT NULL CHECK(amount_jpy BETWEEN 1 AND 10000000),
 credit_posted INTEGER NOT NULL CHECK(credit_posted=1),
 confirmed_at INTEGER NOT NULL CHECK(confirmed_at>0),
 UNIQUE(target_account_id,credit_reference_hash)
);
CREATE TRIGGER IF NOT EXISTS trg_cross_bank_recipient_guard BEFORE INSERT ON family_cross_bank_recipient_evidence
WHEN NOT EXISTS(
 SELECT 1 FROM family_cross_bank_intents i
 JOIN homeflow_identity_links r ON r.user_id=NEW.recipient_user_id
 JOIN family_financial_accounts dst ON dst.account_id=NEW.target_account_id
 WHERE i.request_id=NEW.request_id AND i.status='prepared'
 AND i.household_id=NEW.household_id AND i.recipient_user_id=NEW.recipient_user_id
 AND i.target_account_id=NEW.target_account_id AND i.target_version=NEW.target_version
 AND i.amount_jpy=NEW.amount_jpy AND i.debit_date<=NEW.credit_date
 AND i.expires_at>NEW.confirmed_at AND r.state='active'
 AND r.role='owner' AND r.household_id=NEW.household_id
 AND dst.household_id=NEW.household_id AND dst.owner_user_id=NEW.recipient_user_id
 AND dst.account_kind='bank' AND dst.origin='member_created' AND dst.is_archived=0
 AND dst.version=NEW.target_version
 AND NEW.credit_date<=date(NEW.confirmed_at/1000,'unixepoch','+9 hours')
) BEGIN SELECT RAISE(ABORT,'CROSS_BANK_RECIPIENT_EVIDENCE_INVALID'); END;
CREATE TRIGGER IF NOT EXISTS trg_cross_bank_recipient_immutable_update BEFORE UPDATE ON family_cross_bank_recipient_evidence
BEGIN SELECT RAISE(ABORT,'CROSS_BANK_RECIPIENT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_cross_bank_recipient_immutable_delete BEFORE DELETE ON family_cross_bank_recipient_evidence
BEGIN SELECT RAISE(ABORT,'CROSS_BANK_RECIPIENT_IMMUTABLE'); END;

-- A single transfer entry affects BOTH stable accounts; the separate receipt
-- verifies proof and audit. Exactly one journal per original HomeFlow approval.
CREATE TABLE IF NOT EXISTS family_cross_bank_journal(
 homeflow_request_id TEXT PRIMARY KEY CHECK(length(homeflow_request_id)=36),
 proposal_id TEXT NOT NULL UNIQUE REFERENCES family_cross_bank_intents(request_id) ON DELETE RESTRICT,
 household_id TEXT NOT NULL,
 requester_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 recipient_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 approver_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 actor_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 consent_id TEXT NOT NULL CHECK(length(consent_id)=36),
 source_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 source_version INTEGER NOT NULL,
 target_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 target_version INTEGER NOT NULL,
 amount_jpy INTEGER NOT NULL CHECK(amount_jpy BETWEEN 1 AND 10000000),
 debit_date TEXT NOT NULL,
 credit_date TEXT NOT NULL,
 source_reference_hash TEXT NOT NULL CHECK(length(source_reference_hash)=64),
 credit_reference_hash TEXT NOT NULL CHECK(length(credit_reference_hash)=64),
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 transfer_entry_id INTEGER NOT NULL UNIQUE REFERENCES entries(id) ON DELETE RESTRICT,
 applied_at INTEGER NOT NULL CHECK(applied_at>0),
 UNIQUE(source_account_id,source_reference_hash),
 UNIQUE(target_account_id,credit_reference_hash),
 CHECK(source_account_id<>target_account_id AND requester_user_id<>recipient_user_id),
 CHECK(approver_user_id=recipient_user_id AND actor_user_id=approver_user_id)
);
CREATE INDEX IF NOT EXISTS idx_cross_bank_journal_household
 ON family_cross_bank_journal(household_id,applied_at DESC);
CREATE TRIGGER IF NOT EXISTS trg_cross_bank_journal_guard BEFORE INSERT ON family_cross_bank_journal
WHEN NOT EXISTS(
 SELECT 1 FROM family_cross_bank_intents i
 JOIN family_cross_bank_recipient_evidence r ON r.request_id=i.request_id
 JOIN family_financial_accounts src ON src.account_id=i.source_account_id
 JOIN family_financial_accounts dst ON dst.account_id=i.target_account_id
 JOIN homeflow_identity_links sender ON sender.user_id=i.requester_user_id
 JOIN homeflow_identity_links recipient ON recipient.user_id=i.recipient_user_id
 JOIN entries e ON e.id=NEW.transfer_entry_id
 WHERE i.request_id=NEW.proposal_id AND i.status='submitted'
 AND i.homeflow_approval_id=NEW.homeflow_request_id AND i.consent_id=NEW.consent_id
 AND i.household_id=NEW.household_id AND i.requester_user_id=NEW.requester_user_id
 AND i.recipient_user_id=NEW.recipient_user_id
 AND i.source_account_id=NEW.source_account_id AND i.target_account_id=NEW.target_account_id
 AND i.source_version=NEW.source_version AND i.target_version=NEW.target_version
 AND i.amount_jpy=NEW.amount_jpy AND i.debit_date=NEW.debit_date
 AND i.source_reference_hash=NEW.source_reference_hash AND i.payload_sha256=NEW.payload_sha256
 AND i.expires_at>NEW.applied_at
 AND r.household_id=NEW.household_id AND r.recipient_user_id=NEW.recipient_user_id
 AND r.target_account_id=NEW.target_account_id AND r.target_version=NEW.target_version
 AND r.credit_reference_hash=NEW.credit_reference_hash AND r.credit_date=NEW.credit_date
 AND r.amount_jpy=NEW.amount_jpy AND r.credit_posted=1
 AND sender.household_id=NEW.household_id AND sender.role='member' AND sender.state='active'
 AND recipient.household_id=NEW.household_id AND recipient.role='owner' AND recipient.state='active'
 AND src.household_id=NEW.household_id AND dst.household_id=NEW.household_id
 AND src.owner_user_id=NEW.requester_user_id AND dst.owner_user_id=NEW.recipient_user_id
 AND src.version=NEW.source_version AND dst.version=NEW.target_version
 AND src.account_kind='bank' AND dst.account_kind='bank'
 AND src.origin='member_created' AND dst.origin='member_created'
 AND src.is_archived=0 AND dst.is_archived=0
 AND e.client_request_id='hfcrossbank:'||NEW.homeflow_request_id
 AND e.type='transfer' AND e.amount=NEW.amount_jpy
 AND e.date=NEW.debit_date AND e.transfer_date=NEW.credit_date
 AND e.family_account_id=NEW.source_account_id
 AND e.family_transfer_target_account_id=NEW.target_account_id
 AND e.transfer_target='bank:'||NEW.target_account_id
 AND e.payment_source='bank:'||NEW.source_account_id
 AND e.transfer_applied=1
 AND src.opening_balance+COALESCE((
  SELECT SUM(CASE WHEN x.type='income' AND x.family_account_id=NEW.source_account_id
   THEN x.amount WHEN x.type IN ('expense','transfer') AND x.family_account_id=NEW.source_account_id
   THEN -x.amount WHEN x.type='transfer' AND x.family_transfer_target_account_id=NEW.source_account_id
    AND x.transfer_applied=1 THEN x.amount ELSE 0 END)
  FROM entries x WHERE x.family_account_id=NEW.source_account_id
   OR x.family_transfer_target_account_id=NEW.source_account_id
 ),0)>=0
)
OR EXISTS(SELECT 1 FROM family_bank_transfer_posted_evidence e
 WHERE (e.source_account_id=NEW.source_account_id AND e.source_reference_hash=NEW.source_reference_hash)
 OR (e.target_account_id=NEW.target_account_id AND e.target_reference_hash=NEW.credit_reference_hash))
OR EXISTS(SELECT 1 FROM family_cross_bank_journal old
 WHERE (old.source_account_id=NEW.source_account_id AND old.source_reference_hash=NEW.source_reference_hash)
 OR (old.target_account_id=NEW.target_account_id AND old.credit_reference_hash=NEW.credit_reference_hash))
OR EXISTS(SELECT 1 FROM family_sbi_cash_bank_evidence e
 WHERE e.bank_account_id=NEW.source_account_id AND e.reference_hash=NEW.source_reference_hash)
OR EXISTS(SELECT 1 FROM family_card_bank_debit_evidence e
 WHERE e.bank_account_id=NEW.source_account_id AND e.reference_hash=NEW.source_reference_hash)
BEGIN SELECT RAISE(ABORT,'CROSS_BANK_JOURNAL_OR_STATEMENT_INVALID'); END;
CREATE TRIGGER IF NOT EXISTS trg_cross_bank_journal_immutable_update BEFORE UPDATE ON family_cross_bank_journal
BEGIN SELECT RAISE(ABORT,'CROSS_BANK_JOURNAL_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_cross_bank_journal_immutable_delete BEFORE DELETE ON family_cross_bank_journal
BEGIN SELECT RAISE(ABORT,'CROSS_BANK_JOURNAL_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_cross_bank_entry_immutable_update BEFORE UPDATE ON entries
WHEN EXISTS(SELECT 1 FROM family_cross_bank_journal r WHERE r.transfer_entry_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'CROSS_BANK_ENTRY_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_cross_bank_entry_immutable_delete BEFORE DELETE ON entries
WHEN EXISTS(SELECT 1 FROM family_cross_bank_journal r WHERE r.transfer_entry_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'CROSS_BANK_ENTRY_IMMUTABLE'); END;
CREATE TABLE IF NOT EXISTS family_cross_bank_actor_audit(
 event_id TEXT PRIMARY KEY CHECK(length(event_id)=32),
 homeflow_request_id TEXT NOT NULL UNIQUE REFERENCES family_cross_bank_journal(homeflow_request_id) ON DELETE RESTRICT,
 source_actor_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 recipient_actor_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 owner_authorizer_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 execute_actor_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 action TEXT NOT NULL CHECK(action='cross_member_posted_bank_transfer'),
 created_at INTEGER NOT NULL CHECK(created_at>0)
);
CREATE TRIGGER IF NOT EXISTS trg_cross_bank_audit_guard BEFORE INSERT ON family_cross_bank_actor_audit
WHEN NOT EXISTS(SELECT 1 FROM family_cross_bank_journal j
 WHERE j.homeflow_request_id=NEW.homeflow_request_id
 AND j.requester_user_id=NEW.source_actor_user_id
 AND j.recipient_user_id=NEW.recipient_actor_user_id
 AND j.approver_user_id=NEW.owner_authorizer_user_id
 AND j.actor_user_id=NEW.execute_actor_user_id
 AND j.applied_at=NEW.created_at)
BEGIN SELECT RAISE(ABORT,'CROSS_BANK_AUDIT_COUNTERPART'); END;
CREATE TRIGGER IF NOT EXISTS trg_cross_bank_audit_immutable_update BEFORE UPDATE ON family_cross_bank_actor_audit
BEGIN SELECT RAISE(ABORT,'CROSS_BANK_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_cross_bank_audit_immutable_delete BEFORE DELETE ON family_cross_bank_actor_audit
BEGIN SELECT RAISE(ABORT,'CROSS_BANK_AUDIT_IMMUTABLE'); END;
INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(
 'schema-0049-cross-member-bank-transfer',
 'UNDEPLOYED member-to-owner posted bank transfer only; independent source, recipient, admin and ledger proof');
