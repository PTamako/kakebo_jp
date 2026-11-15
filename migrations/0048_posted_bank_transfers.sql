-- 0048 DRAFT P0-4C: two posted BANK statements, one same-owner bank-to-bank transfer.
-- Neither this internal journal nor approval instructs any external bank to move money.
-- Explicitly does NOT support cash, securities, prepaid, cross-member or pending deposits.
CREATE TABLE IF NOT EXISTS family_bank_transfer_intents(
 request_id TEXT PRIMARY KEY CHECK(length(request_id)=32),
 household_id TEXT NOT NULL,
 requester_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 source_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 source_version INTEGER NOT NULL CHECK(source_version>=1),
 target_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 target_version INTEGER NOT NULL CHECK(target_version>=1),
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 payload_cipher TEXT NOT NULL,payload_iv TEXT NOT NULL,
 idempotency_hash TEXT NOT NULL UNIQUE CHECK(length(idempotency_hash)=64),
 status TEXT NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','submitted','cancelled')),
 homeflow_approval_id TEXT UNIQUE,
 created_at INTEGER NOT NULL CHECK(created_at>0),
 expires_at INTEGER NOT NULL CHECK(expires_at>created_at),
 submitted_at INTEGER,
 CHECK(source_account_id<>target_account_id)
);
CREATE INDEX IF NOT EXISTS idx_bank_transfer_intents_member
 ON family_bank_transfer_intents(household_id,requester_user_id,created_at DESC);
CREATE TRIGGER IF NOT EXISTS trg_bank_transfer_intent_owner BEFORE INSERT ON family_bank_transfer_intents
WHEN NOT EXISTS(
 SELECT 1 FROM homeflow_identity_links member
 JOIN family_financial_accounts src ON src.account_id=NEW.source_account_id
 JOIN family_financial_accounts dst ON dst.account_id=NEW.target_account_id
 WHERE member.user_id=NEW.requester_user_id
 AND member.household_id=NEW.household_id AND member.role='member' AND member.state='active'
 AND src.account_kind='bank' AND dst.account_kind='bank'
 AND src.origin='member_created' AND dst.origin='member_created'
 AND src.is_archived=0 AND dst.is_archived=0
 AND src.version=NEW.source_version AND dst.version=NEW.target_version
 AND src.household_id=NEW.household_id AND dst.household_id=NEW.household_id
 AND src.owner_user_id=NEW.requester_user_id AND dst.owner_user_id=NEW.requester_user_id
)
BEGIN SELECT RAISE(ABORT,'BANK_TRANSFER_ORIGINAL_OWNER_OR_CAS'); END;
CREATE TRIGGER IF NOT EXISTS trg_bank_transfer_intent_immutable BEFORE UPDATE OF
 request_id,household_id,requester_user_id,source_account_id,source_version,
 target_account_id,target_version,payload_sha256,payload_cipher,payload_iv,
 idempotency_hash,created_at,expires_at ON family_bank_transfer_intents
BEGIN SELECT RAISE(ABORT,'BANK_TRANSFER_INTENT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_bank_transfer_intent_status BEFORE UPDATE OF status
 ON family_bank_transfer_intents
WHEN NOT(OLD.status='prepared' AND NEW.status IN ('submitted','cancelled'))
BEGIN SELECT RAISE(ABORT,'BANK_TRANSFER_INTENT_STATE'); END;
CREATE TRIGGER IF NOT EXISTS trg_bank_transfer_intent_no_delete BEFORE DELETE ON family_bank_transfer_intents
BEGIN SELECT RAISE(ABORT,'BANK_TRANSFER_INTENT_IMMUTABLE'); END;

-- Both bank-side references are independently posted, not estimates/pending.
CREATE TABLE IF NOT EXISTS family_bank_transfer_posted_evidence(
 evidence_id TEXT PRIMARY KEY CHECK(length(evidence_id)=32),
 household_id TEXT NOT NULL,
 source_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 source_version INTEGER NOT NULL CHECK(source_version>=1),
 target_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 target_version INTEGER NOT NULL CHECK(target_version>=1),
 source_reference_hash TEXT NOT NULL CHECK(length(source_reference_hash)=64),
 target_reference_hash TEXT NOT NULL CHECK(length(target_reference_hash)=64),
 debit_date TEXT NOT NULL CHECK(length(debit_date)=10),
 credit_date TEXT NOT NULL CHECK(length(credit_date)=10),
 amount_jpy INTEGER NOT NULL CHECK(amount_jpy BETWEEN 1 AND 10000000),
 bank_debit_posted INTEGER NOT NULL CHECK(bank_debit_posted=1),
 bank_credit_posted INTEGER NOT NULL CHECK(bank_credit_posted=1),
 evidence_kind TEXT NOT NULL CHECK(evidence_kind='owner_attested_two_posted_bank_statements'),
 recorded_at INTEGER NOT NULL CHECK(recorded_at>0),
 CHECK(source_account_id<>target_account_id),
 CHECK(debit_date<=credit_date AND credit_date<=date(recorded_at/1000,'unixepoch','+9 hours')),
 UNIQUE(source_account_id,source_reference_hash),
 UNIQUE(target_account_id,target_reference_hash)
);
CREATE TRIGGER IF NOT EXISTS trg_bank_transfer_evidence_guard BEFORE INSERT ON family_bank_transfer_posted_evidence
WHEN NOT EXISTS(
 SELECT 1 FROM family_bank_transfer_intents i
 JOIN family_financial_accounts src ON src.account_id=NEW.source_account_id
 JOIN family_financial_accounts dst ON dst.account_id=NEW.target_account_id
 WHERE i.household_id=NEW.household_id
 AND i.source_account_id=NEW.source_account_id
 AND i.target_account_id=NEW.target_account_id
 AND i.source_version=NEW.source_version AND i.target_version=NEW.target_version
 AND i.status='submitted' AND i.expires_at>NEW.recorded_at
 AND src.account_kind='bank' AND dst.account_kind='bank'
 AND src.origin='member_created' AND dst.origin='member_created'
 AND src.version=NEW.source_version AND dst.version=NEW.target_version
 AND src.household_id=NEW.household_id AND dst.household_id=NEW.household_id
 AND src.owner_user_id=i.requester_user_id AND dst.owner_user_id=i.requester_user_id
 AND src.is_archived=0 AND dst.is_archived=0
 ) OR
 EXISTS(SELECT 1 FROM family_sbi_cash_bank_evidence r
  WHERE (r.bank_account_id=NEW.source_account_id AND r.reference_hash=NEW.source_reference_hash)
  OR (r.bank_account_id=NEW.target_account_id AND r.reference_hash=NEW.target_reference_hash))
 OR EXISTS(SELECT 1 FROM family_card_bank_debit_evidence r
  WHERE (r.bank_account_id=NEW.source_account_id AND r.reference_hash=NEW.source_reference_hash)
  OR (r.bank_account_id=NEW.target_account_id AND r.reference_hash=NEW.target_reference_hash))
 OR EXISTS(SELECT 1 FROM family_sbi_cash_refund_evidence r
  WHERE (r.bank_account_id=NEW.source_account_id AND r.bank_refund_hash=NEW.source_reference_hash)
  OR (r.bank_account_id=NEW.target_account_id AND r.bank_refund_hash=NEW.target_reference_hash))
 OR EXISTS(SELECT 1 FROM family_bank_transfer_posted_evidence r
  WHERE (r.source_account_id=NEW.source_account_id AND r.source_reference_hash=NEW.source_reference_hash)
   OR (r.target_account_id=NEW.source_account_id AND r.target_reference_hash=NEW.source_reference_hash)
   OR (r.source_account_id=NEW.target_account_id AND r.source_reference_hash=NEW.target_reference_hash)
   OR (r.target_account_id=NEW.target_account_id AND r.target_reference_hash=NEW.target_reference_hash))
BEGIN SELECT RAISE(ABORT,'BANK_TRANSFER_STATEMENT_NOT_POSTED_OR_REUSED'); END;
CREATE TRIGGER IF NOT EXISTS trg_bank_transfer_evidence_no_update BEFORE UPDATE ON family_bank_transfer_posted_evidence
BEGIN SELECT RAISE(ABORT,'BANK_TRANSFER_EVIDENCE_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_bank_transfer_evidence_no_delete BEFORE DELETE ON family_bank_transfer_posted_evidence
BEGIN SELECT RAISE(ABORT,'BANK_TRANSFER_EVIDENCE_IMMUTABLE'); END;
-- Subsequent old bank finance writers cannot double-use any already settled reference.
CREATE TRIGGER IF NOT EXISTS trg_bank_transfer_no_later_sbi_debit BEFORE INSERT ON family_sbi_cash_bank_evidence
WHEN EXISTS(SELECT 1 FROM family_bank_transfer_posted_evidence r
 WHERE (r.source_account_id=NEW.bank_account_id AND r.source_reference_hash=NEW.reference_hash)
 OR (r.target_account_id=NEW.bank_account_id AND r.target_reference_hash=NEW.reference_hash))
BEGIN SELECT RAISE(ABORT,'BANK_TRANSFER_STATEMENT_ALREADY_USED'); END;
CREATE TRIGGER IF NOT EXISTS trg_bank_transfer_no_later_card_debit BEFORE INSERT ON family_card_bank_debit_evidence
WHEN EXISTS(SELECT 1 FROM family_bank_transfer_posted_evidence r
 WHERE (r.source_account_id=NEW.bank_account_id AND r.source_reference_hash=NEW.reference_hash)
 OR (r.target_account_id=NEW.bank_account_id AND r.target_reference_hash=NEW.reference_hash))
BEGIN SELECT RAISE(ABORT,'BANK_TRANSFER_STATEMENT_ALREADY_USED'); END;
CREATE TRIGGER IF NOT EXISTS trg_bank_transfer_no_later_sbi_refund BEFORE INSERT ON family_sbi_cash_refund_evidence
WHEN EXISTS(SELECT 1 FROM family_bank_transfer_posted_evidence r
 WHERE (r.source_account_id=NEW.bank_account_id AND r.source_reference_hash=NEW.bank_refund_hash)
 OR (r.target_account_id=NEW.bank_account_id AND r.target_reference_hash=NEW.bank_refund_hash))
BEGIN SELECT RAISE(ABORT,'BANK_TRANSFER_STATEMENT_ALREADY_USED'); END;
CREATE TABLE IF NOT EXISTS family_bank_transfers_applied(
 homeflow_request_id TEXT PRIMARY KEY CHECK(length(homeflow_request_id)=36),
 proposal_id TEXT NOT NULL UNIQUE REFERENCES family_bank_transfer_intents(request_id) ON DELETE RESTRICT,
 household_id TEXT NOT NULL,
 requester_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 approver_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 actor_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 source_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 source_version INTEGER NOT NULL CHECK(source_version>=1),
 target_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 target_version INTEGER NOT NULL CHECK(target_version>=1),
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 evidence_id TEXT NOT NULL UNIQUE REFERENCES family_bank_transfer_posted_evidence(evidence_id) ON DELETE RESTRICT,
 transfer_entry_id INTEGER NOT NULL UNIQUE REFERENCES entries(id) ON DELETE RESTRICT,
 amount_jpy INTEGER NOT NULL CHECK(amount_jpy BETWEEN 1 AND 10000000),
 debit_date TEXT NOT NULL,credit_date TEXT NOT NULL,
 applied_at INTEGER NOT NULL CHECK(applied_at>0),
 CHECK(source_account_id<>target_account_id),
 CHECK(requester_user_id<>approver_user_id AND actor_user_id=approver_user_id),
 CHECK(debit_date<=credit_date)
);
CREATE INDEX IF NOT EXISTS idx_bank_transfers_owner
 ON family_bank_transfers_applied(household_id,requester_user_id,applied_at DESC);
CREATE TRIGGER IF NOT EXISTS trg_bank_transfer_applied_guard BEFORE INSERT ON family_bank_transfers_applied
WHEN NOT EXISTS(
 SELECT 1 FROM family_bank_transfer_intents i
 JOIN family_bank_transfer_posted_evidence evidence ON evidence.evidence_id=NEW.evidence_id
 JOIN entries e ON e.id=NEW.transfer_entry_id
 JOIN family_financial_accounts src ON src.account_id=NEW.source_account_id
 JOIN family_financial_accounts dst ON dst.account_id=NEW.target_account_id
 JOIN homeflow_identity_links member ON member.user_id=NEW.requester_user_id
 JOIN homeflow_identity_links owner ON owner.user_id=NEW.approver_user_id
 WHERE i.request_id=NEW.proposal_id AND i.household_id=NEW.household_id
 AND i.requester_user_id=NEW.requester_user_id AND i.homeflow_approval_id=NEW.homeflow_request_id
 AND i.status='submitted' AND i.expires_at>NEW.applied_at
 AND i.source_account_id=NEW.source_account_id AND i.target_account_id=NEW.target_account_id
 AND i.source_version=NEW.source_version AND i.target_version=NEW.target_version
 AND i.payload_sha256=NEW.payload_sha256
 AND evidence.household_id=NEW.household_id
 AND evidence.source_account_id=NEW.source_account_id
 AND evidence.target_account_id=NEW.target_account_id
 AND evidence.source_version=NEW.source_version AND evidence.target_version=NEW.target_version
 AND evidence.amount_jpy=NEW.amount_jpy
 AND evidence.debit_date=NEW.debit_date AND evidence.credit_date=NEW.credit_date
 AND evidence.bank_debit_posted=1 AND evidence.bank_credit_posted=1
 AND member.household_id=NEW.household_id AND member.state='active' AND member.role='member'
 AND owner.household_id=NEW.household_id AND owner.state='active' AND owner.role='owner'
 AND src.household_id=NEW.household_id AND dst.household_id=NEW.household_id
 AND src.owner_user_id=NEW.requester_user_id AND dst.owner_user_id=NEW.requester_user_id
 AND src.version=NEW.source_version AND dst.version=NEW.target_version
 AND src.origin='member_created' AND dst.origin='member_created'
 AND src.account_kind='bank' AND dst.account_kind='bank'
 AND src.is_archived=0 AND dst.is_archived=0
 AND e.client_request_id='hfbanktransfer:'||NEW.homeflow_request_id
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
BEGIN SELECT RAISE(ABORT,'BANK_TRANSFER_DOUBLE_ENTRY_OR_BALANCE_INVALID'); END;
CREATE TRIGGER IF NOT EXISTS trg_bank_transfer_applied_no_update BEFORE UPDATE ON family_bank_transfers_applied
BEGIN SELECT RAISE(ABORT,'BANK_TRANSFER_APPLIED_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_bank_transfer_applied_no_delete BEFORE DELETE ON family_bank_transfers_applied
BEGIN SELECT RAISE(ABORT,'BANK_TRANSFER_APPLIED_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_bank_transfer_entry_no_update BEFORE UPDATE ON entries
WHEN EXISTS(SELECT 1 FROM family_bank_transfers_applied r WHERE r.transfer_entry_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'BANK_TRANSFER_ENTRY_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_bank_transfer_entry_no_delete BEFORE DELETE ON entries
WHEN EXISTS(SELECT 1 FROM family_bank_transfers_applied r WHERE r.transfer_entry_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'BANK_TRANSFER_ENTRY_IMMUTABLE'); END;
CREATE TABLE IF NOT EXISTS family_bank_transfer_actor_audit(
 event_id TEXT PRIMARY KEY CHECK(length(event_id)=32),
 homeflow_request_id TEXT NOT NULL UNIQUE REFERENCES family_bank_transfers_applied(homeflow_request_id) ON DELETE RESTRICT,
 requester_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 approver_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 actor_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 action TEXT NOT NULL CHECK(action='posted_bank_to_bank_transfer_applied'),
 created_at INTEGER NOT NULL CHECK(created_at>0)
);
CREATE TRIGGER IF NOT EXISTS trg_bank_transfer_audit_guard BEFORE INSERT ON family_bank_transfer_actor_audit
WHEN NOT EXISTS(SELECT 1 FROM family_bank_transfers_applied a
 WHERE a.homeflow_request_id=NEW.homeflow_request_id AND a.requester_user_id=NEW.requester_user_id
 AND a.approver_user_id=NEW.approver_user_id AND a.actor_user_id=NEW.actor_user_id
 AND a.applied_at=NEW.created_at)
BEGIN SELECT RAISE(ABORT,'BANK_TRANSFER_AUDIT_COUNTERPART'); END;
CREATE TRIGGER IF NOT EXISTS trg_bank_transfer_audit_no_update BEFORE UPDATE ON family_bank_transfer_actor_audit
BEGIN SELECT RAISE(ABORT,'BANK_TRANSFER_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_bank_transfer_audit_no_delete BEFORE DELETE ON family_bank_transfer_actor_audit
BEGIN SELECT RAISE(ABORT,'BANK_TRANSFER_AUDIT_IMMUTABLE'); END;
INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(
 'schema-0048-posted-bank-to-bank-transfers',
 'UNDEPLOYED confirmed two-bank-statement single-household owner-approved exact double-entry transfer');
