-- 0045 DRAFT ONLY: SBI cash purchase FULL compensation journal, never broker instructions.
-- No live bank credit may be inferred from an approval or broker cancellation alone.
-- A reversal requires separately attested completed broker cancellation AND posted bank refund.
-- Original bank debit, transfer, acquired lot, trade evidence and actor audit are immutable.
-- Partial redemption / units already sold are NOT supported by this reversal.
CREATE TABLE IF NOT EXISTS family_sbi_cash_reversal_intents(
 request_id TEXT PRIMARY KEY CHECK(length(request_id)=32),
 original_request_id TEXT NOT NULL UNIQUE REFERENCES family_sbi_cash_applied(homeflow_request_id) ON DELETE RESTRICT,
 household_id TEXT NOT NULL,
 requester_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 bank_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 bank_version INTEGER NOT NULL CHECK(bank_version>=1),
 securities_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 securities_version INTEGER NOT NULL CHECK(securities_version>=1),
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 payload_cipher TEXT NOT NULL,
 payload_iv TEXT NOT NULL,
 idempotency_hash TEXT NOT NULL UNIQUE CHECK(length(idempotency_hash)=64),
 status TEXT NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','submitted','cancelled')),
 homeflow_approval_id TEXT UNIQUE,
 created_at INTEGER NOT NULL CHECK(created_at>0),
 expires_at INTEGER NOT NULL CHECK(expires_at>created_at),
 submitted_at INTEGER,
 CHECK(bank_account_id<>securities_account_id)
);
CREATE INDEX IF NOT EXISTS idx_sbi_cash_reversal_intents_owner
 ON family_sbi_cash_reversal_intents(household_id,requester_user_id,created_at DESC);
CREATE TRIGGER IF NOT EXISTS trg_sbi_cash_rev_intent_original BEFORE INSERT ON family_sbi_cash_reversal_intents
WHEN NOT EXISTS(
 SELECT 1 FROM family_sbi_cash_applied a
 JOIN family_sbi_cash_lots l ON l.homeflow_request_id=a.homeflow_request_id
 JOIN family_financial_accounts bank ON bank.account_id=a.bank_account_id
 JOIN family_financial_accounts sec ON sec.account_id=a.securities_account_id
 JOIN homeflow_identity_links member ON member.user_id=NEW.requester_user_id
 WHERE a.homeflow_request_id=NEW.original_request_id
 AND a.household_id=NEW.household_id AND a.requester_user_id=NEW.requester_user_id
 AND a.bank_account_id=NEW.bank_account_id AND a.securities_account_id=NEW.securities_account_id
 AND bank.owner_user_id=NEW.requester_user_id AND sec.owner_user_id=NEW.requester_user_id
 AND bank.household_id=NEW.household_id AND sec.household_id=NEW.household_id
 AND bank.version=NEW.bank_version AND sec.version=NEW.securities_version
 AND bank.is_archived=0 AND sec.is_archived=0
 AND bank.origin='member_created' AND sec.origin='member_created'
 AND bank.account_kind='bank' AND sec.account_kind='securities'
 AND member.household_id=NEW.household_id AND member.role='member' AND member.state='active'
) OR EXISTS(SELECT 1 FROM family_sbi_cash_reversals r
 WHERE r.original_request_id=NEW.original_request_id)
BEGIN SELECT RAISE(ABORT,'SBI_REVERSAL_ORIGINAL_OR_OWNER_CHANGED'); END;
CREATE TRIGGER IF NOT EXISTS trg_sbi_cash_rev_intent_immutable BEFORE UPDATE OF
 request_id,original_request_id,household_id,requester_user_id,bank_account_id,bank_version,
 securities_account_id,securities_version,payload_sha256,payload_cipher,payload_iv,
 idempotency_hash,created_at,expires_at ON family_sbi_cash_reversal_intents
BEGIN SELECT RAISE(ABORT,'SBI_REVERSAL_INTENT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_sbi_cash_rev_intent_transition BEFORE UPDATE OF status ON family_sbi_cash_reversal_intents
WHEN NOT(OLD.status='prepared' AND NEW.status IN ('submitted','cancelled'))
BEGIN SELECT RAISE(ABORT,'SBI_REVERSAL_INTENT_STATE'); END;
CREATE TRIGGER IF NOT EXISTS trg_sbi_cash_rev_intent_no_delete BEFORE DELETE ON family_sbi_cash_reversal_intents
BEGIN SELECT RAISE(ABORT,'SBI_REVERSAL_INTENT_IMMUTABLE'); END;

-- Evidence remains an owner's explicit attestation, NOT an API-verified bank statement.
-- Bank refund must already be posted, not merely scheduled or expected.
CREATE TABLE IF NOT EXISTS family_sbi_cash_refund_evidence(
 evidence_id TEXT PRIMARY KEY CHECK(length(evidence_id)=32),
 household_id TEXT NOT NULL,
 original_request_id TEXT NOT NULL REFERENCES family_sbi_cash_applied(homeflow_request_id) ON DELETE RESTRICT,
 bank_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 bank_version INTEGER NOT NULL CHECK(bank_version>=1),
 bank_refund_hash TEXT NOT NULL CHECK(length(bank_refund_hash)=64),
 broker_cancel_hash TEXT NOT NULL CHECK(length(broker_cancel_hash)=64),
 bank_refund_date TEXT NOT NULL CHECK(length(bank_refund_date)=10),
 broker_cancel_date TEXT NOT NULL CHECK(length(broker_cancel_date)=10),
 amount_jpy INTEGER NOT NULL CHECK(amount_jpy BETWEEN 1 AND 10000000),
 bank_refund_confirmed INTEGER NOT NULL CHECK(bank_refund_confirmed=1),
 broker_cancel_confirmed INTEGER NOT NULL CHECK(broker_cancel_confirmed=1),
 evidence_kind TEXT NOT NULL CHECK(evidence_kind='owner_attested_posted_refund'),
 recorded_at INTEGER NOT NULL CHECK(recorded_at>0),
 UNIQUE(bank_account_id,bank_refund_hash),
 UNIQUE(broker_cancel_hash),
 UNIQUE(original_request_id)
);
CREATE TRIGGER IF NOT EXISTS trg_sbi_cash_refund_evidence_guard BEFORE INSERT ON family_sbi_cash_refund_evidence
WHEN NOT EXISTS(
 SELECT 1 FROM family_sbi_cash_applied a
 JOIN family_sbi_cash_bank_evidence debit ON debit.evidence_id=a.evidence_id
 JOIN family_sbi_cash_lots l ON l.homeflow_request_id=a.homeflow_request_id
 JOIN family_financial_accounts bank ON bank.account_id=NEW.bank_account_id
 WHERE a.homeflow_request_id=NEW.original_request_id AND a.household_id=NEW.household_id
 AND a.bank_account_id=NEW.bank_account_id AND a.bank_version=NEW.bank_version
 AND a.amount_jpy=NEW.amount_jpy AND bank.version=NEW.bank_version
 AND bank.is_archived=0 AND bank.origin='member_created'
 AND bank.owner_user_id=a.requester_user_id AND bank.household_id=NEW.household_id
 AND NEW.bank_refund_hash<>debit.reference_hash
 AND NEW.broker_cancel_hash<>l.broker_reference_hash
 AND NEW.broker_cancel_date>=l.trade_date
 AND NEW.bank_refund_date>=NEW.broker_cancel_date
 AND NEW.bank_refund_date>=a.debit_date
 AND NEW.bank_refund_date<=date(NEW.recorded_at/1000,'unixepoch','+9 hours')
) OR EXISTS(SELECT 1 FROM family_sbi_cash_bank_evidence d
 WHERE d.bank_account_id=NEW.bank_account_id AND d.reference_hash=NEW.bank_refund_hash)
 OR EXISTS(SELECT 1 FROM family_card_bank_debit_evidence d
 WHERE d.bank_account_id=NEW.bank_account_id AND d.reference_hash=NEW.bank_refund_hash)
BEGIN SELECT RAISE(ABORT,'SBI_REFUND_NOT_POSTED_OR_EVIDENCE_REUSED'); END;
CREATE TRIGGER IF NOT EXISTS trg_sbi_cash_refund_evidence_no_update BEFORE UPDATE ON family_sbi_cash_refund_evidence
BEGIN SELECT RAISE(ABORT,'SBI_REFUND_EVIDENCE_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_sbi_cash_refund_evidence_no_delete BEFORE DELETE ON family_sbi_cash_refund_evidence
BEGIN SELECT RAISE(ABORT,'SBI_REFUND_EVIDENCE_IMMUTABLE'); END;
-- Future debits cannot reuse a refund reference either.
CREATE TRIGGER IF NOT EXISTS trg_sbi_cash_debit_no_refund_reference BEFORE INSERT ON family_sbi_cash_bank_evidence
WHEN EXISTS(SELECT 1 FROM family_sbi_cash_refund_evidence r
 WHERE r.bank_account_id=NEW.bank_account_id AND r.bank_refund_hash=NEW.reference_hash)
BEGIN SELECT RAISE(ABORT,'SBI_REFUND_REFERENCE_ALREADY_USED'); END;
CREATE TRIGGER IF NOT EXISTS trg_sbi_card_debit_no_refund_reference BEFORE INSERT ON family_card_bank_debit_evidence
WHEN EXISTS(SELECT 1 FROM family_sbi_cash_refund_evidence r
 WHERE r.bank_account_id=NEW.bank_account_id AND r.bank_refund_hash=NEW.reference_hash)
BEGIN SELECT RAISE(ABORT,'SBI_REFUND_REFERENCE_ALREADY_USED'); END;

CREATE TABLE IF NOT EXISTS family_sbi_cash_reversals(
 homeflow_request_id TEXT PRIMARY KEY,
 proposal_id TEXT NOT NULL UNIQUE REFERENCES family_sbi_cash_reversal_intents(request_id) ON DELETE RESTRICT,
 original_request_id TEXT NOT NULL UNIQUE REFERENCES family_sbi_cash_applied(homeflow_request_id) ON DELETE RESTRICT,
 household_id TEXT NOT NULL,
 requester_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 approver_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 actor_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 bank_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 bank_version INTEGER NOT NULL,
 securities_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 securities_version INTEGER NOT NULL,
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 evidence_id TEXT NOT NULL UNIQUE REFERENCES family_sbi_cash_refund_evidence(evidence_id) ON DELETE RESTRICT,
 reversal_entry_id INTEGER NOT NULL UNIQUE REFERENCES entries(id) ON DELETE RESTRICT,
 amount_jpy INTEGER NOT NULL CHECK(amount_jpy BETWEEN 1 AND 10000000),
 reversed_units INTEGER NOT NULL CHECK(reversed_units BETWEEN 1 AND 1000000000000),
 reversed_cost_jpy INTEGER NOT NULL CHECK(reversed_cost_jpy BETWEEN 1 AND 10000000),
 bank_refund_date TEXT NOT NULL,
 broker_cancel_date TEXT NOT NULL,
 applied_at INTEGER NOT NULL CHECK(applied_at>0)
);
CREATE INDEX IF NOT EXISTS idx_sbi_cash_reversal_owner
 ON family_sbi_cash_reversals(household_id,requester_user_id,applied_at DESC);
CREATE TRIGGER IF NOT EXISTS trg_sbi_cash_reversal_guard BEFORE INSERT ON family_sbi_cash_reversals
WHEN NOT EXISTS(
 SELECT 1 FROM family_sbi_cash_reversal_intents i
 JOIN family_sbi_cash_applied original ON original.homeflow_request_id=i.original_request_id
 JOIN family_sbi_cash_lots lot ON lot.homeflow_request_id=original.homeflow_request_id
 JOIN family_sbi_cash_refund_evidence proof ON proof.evidence_id=NEW.evidence_id
 JOIN entries entry ON entry.id=NEW.reversal_entry_id
 JOIN family_financial_accounts bank ON bank.account_id=NEW.bank_account_id
 JOIN family_financial_accounts sec ON sec.account_id=NEW.securities_account_id
 JOIN homeflow_identity_links member ON member.user_id=NEW.requester_user_id
 JOIN homeflow_identity_links approver ON approver.user_id=NEW.approver_user_id
 WHERE i.request_id=NEW.proposal_id AND i.status='submitted'
 AND i.homeflow_approval_id=NEW.homeflow_request_id AND i.expires_at>NEW.applied_at
 AND i.payload_sha256=NEW.payload_sha256 AND i.original_request_id=NEW.original_request_id
 AND i.household_id=NEW.household_id AND i.requester_user_id=NEW.requester_user_id
 AND i.bank_account_id=NEW.bank_account_id AND i.securities_account_id=NEW.securities_account_id
 AND i.bank_version=NEW.bank_version AND i.securities_version=NEW.securities_version
 AND original.household_id=NEW.household_id AND original.requester_user_id=NEW.requester_user_id
 AND original.bank_account_id=NEW.bank_account_id
 AND original.securities_account_id=NEW.securities_account_id
 AND original.amount_jpy=NEW.amount_jpy
 AND lot.confirmed_units=NEW.reversed_units AND lot.acquisition_cost_jpy=NEW.reversed_cost_jpy
 AND NEW.reversed_cost_jpy=NEW.amount_jpy
 AND bank.version=NEW.bank_version AND sec.version=NEW.securities_version
 AND bank.is_archived=0 AND sec.is_archived=0
 AND bank.account_kind='bank' AND sec.account_kind='securities'
 AND bank.origin='member_created' AND sec.origin='member_created'
 AND bank.owner_user_id=NEW.requester_user_id AND sec.owner_user_id=NEW.requester_user_id
 AND bank.household_id=NEW.household_id AND sec.household_id=NEW.household_id
 AND member.household_id=NEW.household_id AND member.role='member' AND member.state='active'
 AND approver.household_id=NEW.household_id AND approver.role='owner' AND approver.state='active'
 AND NEW.approver_user_id<>NEW.requester_user_id AND NEW.actor_user_id=NEW.approver_user_id
 AND proof.original_request_id=NEW.original_request_id
 AND proof.household_id=NEW.household_id AND proof.bank_account_id=NEW.bank_account_id
 AND proof.bank_version=NEW.bank_version AND proof.amount_jpy=NEW.amount_jpy
 AND proof.bank_refund_date=NEW.bank_refund_date
 AND proof.broker_cancel_date=NEW.broker_cancel_date
 AND entry.type='transfer' AND entry.amount=NEW.amount_jpy
 AND entry.client_request_id='hfsbicashrefund:'||NEW.homeflow_request_id
 AND entry.date=NEW.bank_refund_date AND entry.transfer_date=NEW.bank_refund_date
 AND entry.family_account_id=NEW.securities_account_id
 AND entry.family_transfer_target_account_id=NEW.bank_account_id
 AND entry.transfer_target='bank:'||NEW.bank_account_id
 AND entry.payment_source='sbi:'||NEW.securities_account_id
 AND entry.transfer_applied=1
 AND NEW.bank_refund_date>=original.effective_date
 -- Securities cannot refund money already transferred, redeemed, or spent elsewhere.
 AND sec.opening_balance+COALESCE((
  SELECT SUM(CASE WHEN x.type='income' AND x.family_account_id=NEW.securities_account_id
   THEN x.amount WHEN x.type IN ('expense','transfer')
   AND x.family_account_id=NEW.securities_account_id THEN -x.amount
   WHEN x.type='transfer' AND x.family_transfer_target_account_id=NEW.securities_account_id
   AND x.transfer_applied=1 THEN x.amount ELSE 0 END)
  FROM entries x WHERE x.family_account_id=NEW.securities_account_id
   OR x.family_transfer_target_account_id=NEW.securities_account_id
 ),0)>=0
)
BEGIN SELECT RAISE(ABORT,'SBI_REFUND_COUNTERPART_OR_IDENTITY_INVALID'); END;
CREATE TRIGGER IF NOT EXISTS trg_sbi_cash_reversal_no_update BEFORE UPDATE ON family_sbi_cash_reversals
BEGIN SELECT RAISE(ABORT,'SBI_REFUND_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_sbi_cash_reversal_no_delete BEFORE DELETE ON family_sbi_cash_reversals
BEGIN SELECT RAISE(ABORT,'SBI_REFUND_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_sbi_cash_refund_entry_no_update BEFORE UPDATE ON entries
WHEN EXISTS(SELECT 1 FROM family_sbi_cash_reversals r WHERE r.reversal_entry_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'SBI_REFUND_ENTRY_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_sbi_cash_refund_entry_no_delete BEFORE DELETE ON entries
WHEN EXISTS(SELECT 1 FROM family_sbi_cash_reversals r WHERE r.reversal_entry_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'SBI_REFUND_ENTRY_IMMUTABLE'); END;
CREATE TABLE IF NOT EXISTS family_sbi_cash_reversal_audit(
 event_id TEXT PRIMARY KEY,
 homeflow_request_id TEXT NOT NULL UNIQUE REFERENCES family_sbi_cash_reversals(homeflow_request_id) ON DELETE RESTRICT,
 original_request_id TEXT NOT NULL UNIQUE REFERENCES family_sbi_cash_applied(homeflow_request_id) ON DELETE RESTRICT,
 requester_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id),
 approver_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id),
 actor_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id),
 action TEXT NOT NULL CHECK(action='sbi_cash_full_refund_applied'),
 created_at INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS trg_sbi_cash_reversal_audit_guard BEFORE INSERT ON family_sbi_cash_reversal_audit
WHEN NOT EXISTS(SELECT 1 FROM family_sbi_cash_reversals r WHERE r.homeflow_request_id=NEW.homeflow_request_id
 AND r.original_request_id=NEW.original_request_id AND r.requester_user_id=NEW.requester_user_id
 AND r.approver_user_id=NEW.approver_user_id AND r.actor_user_id=NEW.actor_user_id
 AND r.applied_at=NEW.created_at)
BEGIN SELECT RAISE(ABORT,'SBI_REFUND_AUDIT_COUNTERPART'); END;
CREATE TRIGGER IF NOT EXISTS trg_sbi_cash_reversal_audit_no_update BEFORE UPDATE ON family_sbi_cash_reversal_audit
BEGIN SELECT RAISE(ABORT,'SBI_REFUND_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_sbi_cash_reversal_audit_no_delete BEFORE DELETE ON family_sbi_cash_reversal_audit
BEGIN SELECT RAISE(ABORT,'SBI_REFUND_AUDIT_IMMUTABLE'); END;
INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(
 'schema-0045-sbi-cash-reversals',
 'UNDEPLOYED posted bank refund plus completed broker cancellation, reverse transfer and full lot-cost immutable journal');
