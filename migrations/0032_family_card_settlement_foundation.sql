-- 0032 / P0-4 Draft only. Not a production migration or a settlement API.
-- Account-scoped payment allocations reference canonical 0031 card purchases.
-- A real bank debit date/reference must be supplied, never inferred from closing_day.
-- All four journal components must be inserted in ONE D1 transaction.
CREATE TABLE IF NOT EXISTS family_card_settlement_intents (
 request_id TEXT PRIMARY KEY CHECK(length(request_id)=32),
 household_id TEXT NOT NULL,
 requester_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 card_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 card_version INTEGER NOT NULL CHECK(card_version>=1),
 bank_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 bank_version INTEGER NOT NULL CHECK(bank_version>=1),
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 payload_cipher TEXT NOT NULL,
 payload_iv TEXT NOT NULL,
 idempotency_hash TEXT NOT NULL UNIQUE CHECK(length(idempotency_hash)=64),
 status TEXT NOT NULL CHECK(status IN ('prepared','submitted','cancelled')),
 homeflow_approval_id TEXT UNIQUE,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL CHECK(expires_at>created_at),
 submitted_at INTEGER,
 CHECK(card_account_id<>bank_account_id),
 CHECK((status='prepared' AND homeflow_approval_id IS NULL AND submitted_at IS NULL)
  OR (status='submitted' AND length(homeflow_approval_id)=36 AND submitted_at>0)
  OR (status='cancelled' AND homeflow_approval_id IS NULL AND submitted_at IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_family_card_settlement_member
 ON family_card_settlement_intents(household_id,requester_user_id,created_at DESC);
CREATE TRIGGER IF NOT EXISTS trg_family_card_settlement_intent_owner
 BEFORE INSERT ON family_card_settlement_intents
 WHEN NOT EXISTS(
 SELECT 1 FROM family_financial_accounts c
 JOIN family_financial_accounts b ON b.account_id=NEW.bank_account_id
 JOIN homeflow_identity_links u ON u.user_id=NEW.requester_user_id
 WHERE c.account_id=NEW.card_account_id AND c.account_kind='credit_card'
 AND b.account_kind='bank' AND c.origin='member_created' AND b.origin='member_created'
 AND c.household_id=NEW.household_id AND b.household_id=NEW.household_id
 AND c.owner_user_id=NEW.requester_user_id AND b.owner_user_id=NEW.requester_user_id
 AND c.version=NEW.card_version AND b.version=NEW.bank_version
 AND c.is_archived=0 AND b.is_archived=0 AND u.household_id=NEW.household_id
 AND u.role='member' AND u.state='active')
 BEGIN SELECT RAISE(ABORT,'CARD_SETTLEMENT_ACCOUNT_VERSION_OR_OWNER'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_card_settlement_intent_no_identity_edit
 BEFORE UPDATE OF request_id,household_id,requester_user_id,card_account_id,card_version,
 bank_account_id,bank_version,payload_sha256,payload_cipher,payload_iv,
 idempotency_hash,created_at,expires_at ON family_card_settlement_intents
 BEGIN SELECT RAISE(ABORT,'CARD_SETTLEMENT_INTENT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_card_settlement_intent_transition
 BEFORE UPDATE ON family_card_settlement_intents
 WHEN NOT(OLD.status='prepared' AND NEW.status IN ('submitted','cancelled'))
 BEGIN SELECT RAISE(ABORT,'CARD_SETTLEMENT_INTENT_TRANSITION'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_card_settlement_intent_no_delete
 BEFORE DELETE ON family_card_settlement_intents
 BEGIN SELECT RAISE(ABORT,'CARD_SETTLEMENT_INTENT_IMMUTABLE'); END;

-- Bank transaction evidence: reference HASH is scoped to stable bank ID.
-- This is a recorded/owner-confirmed statement, NOT direct bank API verification.
-- Caller must prove its provenance before invoking any future write executor.
CREATE TABLE IF NOT EXISTS family_card_bank_debit_evidence (
 evidence_id TEXT PRIMARY KEY CHECK(length(evidence_id)=32),
 household_id TEXT NOT NULL,
 bank_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 bank_version INTEGER NOT NULL CHECK(bank_version>=1),
 reference_hash TEXT NOT NULL CHECK(length(reference_hash)=64),
 debit_date TEXT NOT NULL CHECK(length(debit_date)=10),
 amount_jpy INTEGER NOT NULL CHECK(amount_jpy BETWEEN 1 AND 10000000),
 evidence_kind TEXT NOT NULL CHECK(evidence_kind IN ('statement_import','owner_confirmed_statement')),
 recorded_at INTEGER NOT NULL CHECK(recorded_at>0),
 UNIQUE(bank_account_id,reference_hash)
);
CREATE INDEX IF NOT EXISTS idx_family_card_bank_debits_date
 ON family_card_bank_debit_evidence(household_id,bank_account_id,debit_date);
CREATE TRIGGER IF NOT EXISTS trg_family_card_bank_debit_owner
 BEFORE INSERT ON family_card_bank_debit_evidence
 WHEN NOT EXISTS(SELECT 1 FROM family_financial_accounts a
 WHERE a.account_id=NEW.bank_account_id AND a.household_id=NEW.household_id
 AND a.version=NEW.bank_version AND a.is_archived=0 AND a.account_kind='bank')
 BEGIN SELECT RAISE(ABORT,'BANK_DEBIT_ACCOUNT_VERSION'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_card_bank_debit_no_update
 BEFORE UPDATE ON family_card_bank_debit_evidence
 BEGIN SELECT RAISE(ABORT,'BANK_DEBIT_EVIDENCE_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_card_bank_debit_no_delete
 BEFORE DELETE ON family_card_bank_debit_evidence
 BEGIN SELECT RAISE(ABORT,'BANK_DEBIT_EVIDENCE_IMMUTABLE'); END;

-- Payment is a TRANSFER, not another expense. Date comes from the evidence.
CREATE TABLE IF NOT EXISTS family_card_settlements_applied (
 homeflow_request_id TEXT PRIMARY KEY CHECK(length(homeflow_request_id)=36),
 proposal_id TEXT NOT NULL UNIQUE REFERENCES family_card_settlement_intents(request_id) ON DELETE RESTRICT,
 household_id TEXT NOT NULL,
 requester_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 approver_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 actor_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 card_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 card_version INTEGER NOT NULL CHECK(card_version>=1),
 bank_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 bank_version INTEGER NOT NULL CHECK(bank_version>=1),
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 evidence_id TEXT NOT NULL UNIQUE REFERENCES family_card_bank_debit_evidence(evidence_id) ON DELETE RESTRICT,
 transfer_entry_id INTEGER NOT NULL UNIQUE REFERENCES entries(id) ON DELETE RESTRICT,
 amount_jpy INTEGER NOT NULL CHECK(amount_jpy BETWEEN 1 AND 10000000),
 debit_date TEXT NOT NULL CHECK(length(debit_date)=10),
 applied_at INTEGER NOT NULL CHECK(applied_at>0),
 CHECK(approver_user_id<>requester_user_id),
 CHECK(actor_user_id=approver_user_id)
);
CREATE INDEX IF NOT EXISTS idx_family_card_settled_account
 ON family_card_settlements_applied(household_id,card_account_id,debit_date);
CREATE TRIGGER IF NOT EXISTS trg_family_card_settlement_match
 BEFORE INSERT ON family_card_settlements_applied
 WHEN NOT EXISTS(
 SELECT 1 FROM family_card_settlement_intents p
 JOIN family_card_bank_debit_evidence d ON d.evidence_id=NEW.evidence_id
 JOIN entries e ON e.id=NEW.transfer_entry_id
 JOIN family_financial_accounts c ON c.account_id=NEW.card_account_id
 JOIN family_financial_accounts b ON b.account_id=NEW.bank_account_id
 JOIN homeflow_identity_links requester ON requester.user_id=NEW.requester_user_id
 JOIN homeflow_identity_links approver ON approver.user_id=NEW.approver_user_id
 WHERE p.request_id=NEW.proposal_id AND p.status='submitted'
 AND p.homeflow_approval_id=NEW.homeflow_request_id
 AND p.household_id=NEW.household_id AND p.requester_user_id=NEW.requester_user_id
 AND p.card_account_id=NEW.card_account_id AND p.card_version=NEW.card_version
 AND p.bank_account_id=NEW.bank_account_id AND p.bank_version=NEW.bank_version
 AND p.payload_sha256=NEW.payload_sha256
 AND c.household_id=NEW.household_id AND b.household_id=NEW.household_id
 AND c.owner_user_id=NEW.requester_user_id AND b.owner_user_id=NEW.requester_user_id
 AND c.account_kind='credit_card' AND b.account_kind='bank'
 AND c.origin='member_created' AND b.origin='member_created'
 AND c.version=NEW.card_version AND b.version=NEW.bank_version
 AND c.is_archived=0 AND b.is_archived=0
 AND requester.household_id=NEW.household_id AND approver.household_id=NEW.household_id
 AND requester.role='member' AND requester.state='active'
 AND approver.role='owner' AND approver.state='active'
 AND d.household_id=NEW.household_id AND d.bank_account_id=NEW.bank_account_id
 AND d.bank_version=NEW.bank_version
 AND d.amount_jpy=NEW.amount_jpy AND d.debit_date=NEW.debit_date
 AND e.date=NEW.debit_date AND e.amount=NEW.amount_jpy AND e.type='transfer'
 AND e.family_account_id=NEW.bank_account_id
 AND e.family_transfer_target_account_id=NEW.card_account_id
 AND e.payment_source='bank:'||NEW.bank_account_id
 AND e.transfer_target='cc:'||NEW.card_account_id
 AND e.transfer_applied=1 AND e.transfer_date=NEW.debit_date
 AND e.client_request_id='hfcardsettle:'||NEW.homeflow_request_id)
 BEGIN SELECT RAISE(ABORT,'CARD_SETTLEMENT_DEBIT_NOT_MATCHED'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_card_settlement_no_update
 BEFORE UPDATE ON family_card_settlements_applied
 BEGIN SELECT RAISE(ABORT,'CARD_SETTLEMENT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_card_settlement_no_delete
 BEFORE DELETE ON family_card_settlements_applied
 BEGIN SELECT RAISE(ABORT,'CARD_SETTLEMENT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_card_settlement_transfer_no_edit
 BEFORE UPDATE ON entries
 WHEN EXISTS(SELECT 1 FROM family_card_settlements_applied s WHERE s.transfer_entry_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'CARD_BANK_DEBIT_ENTRY_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_card_settlement_transfer_no_delete
 BEFORE DELETE ON entries
 WHEN EXISTS(SELECT 1 FROM family_card_settlements_applied s WHERE s.transfer_entry_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'CARD_BANK_DEBIT_ENTRY_IMMUTABLE'); END;

-- A single bank debit can pay multiple existing purchases, even across bills.
-- SQLite serializes writers; trigger recomputes remaining principal at INSERT.
CREATE TABLE IF NOT EXISTS family_card_settlement_allocations (
 homeflow_request_id TEXT NOT NULL REFERENCES family_card_settlements_applied(homeflow_request_id) ON DELETE RESTRICT,
 purchase_request_id TEXT NOT NULL REFERENCES family_card_purchase_applied(homeflow_request_id) ON DELETE RESTRICT,
 amount_jpy INTEGER NOT NULL CHECK(amount_jpy BETWEEN 1 AND 10000000),
 PRIMARY KEY(homeflow_request_id,purchase_request_id)
);
CREATE INDEX IF NOT EXISTS idx_family_card_allocation_purchase
 ON family_card_settlement_allocations(purchase_request_id);
CREATE TRIGGER IF NOT EXISTS trg_family_card_allocation_balance
 BEFORE INSERT ON family_card_settlement_allocations
 WHEN NOT EXISTS(
 SELECT 1 FROM family_card_purchase_applied p
 JOIN family_card_settlements_applied s ON s.homeflow_request_id=NEW.homeflow_request_id
 WHERE p.homeflow_request_id=NEW.purchase_request_id
 AND p.household_id=s.household_id AND p.account_id=s.card_account_id
 AND p.purchase_date<=s.debit_date
 AND NEW.amount_jpy<=p.amount_jpy-COALESCE((
  SELECT SUM(a.amount_jpy) FROM family_card_settlement_allocations a
  WHERE a.purchase_request_id=NEW.purchase_request_id),0))
 BEGIN SELECT RAISE(ABORT,'CARD_SETTLEMENT_OVERPAY_OR_WRONG_ACCOUNT'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_card_allocation_no_update
 BEFORE UPDATE ON family_card_settlement_allocations
 BEGIN SELECT RAISE(ABORT,'CARD_SETTLEMENT_ALLOCATION_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_card_allocation_no_delete
 BEFORE DELETE ON family_card_settlement_allocations
 BEGIN SELECT RAISE(ABORT,'CARD_SETTLEMENT_ALLOCATION_IMMUTABLE'); END;

-- Must be final statement in the single transaction. It checks the exact sum.
CREATE TABLE IF NOT EXISTS family_card_settlement_audit (
 event_id TEXT PRIMARY KEY NOT NULL,
 homeflow_request_id TEXT NOT NULL UNIQUE REFERENCES family_card_settlements_applied(homeflow_request_id) ON DELETE RESTRICT,
 requester_user_id TEXT NOT NULL,
 approver_user_id TEXT NOT NULL,
 actor_user_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action='credit_card_bank_settlement_applied'),
 created_at INTEGER NOT NULL CHECK(created_at>0)
);
CREATE TRIGGER IF NOT EXISTS trg_family_card_settlement_audit_guard
 BEFORE INSERT ON family_card_settlement_audit
 WHEN NOT EXISTS(
 SELECT 1 FROM family_card_settlements_applied s
 WHERE s.homeflow_request_id=NEW.homeflow_request_id
 AND s.requester_user_id=NEW.requester_user_id
 AND s.approver_user_id=NEW.approver_user_id
 AND s.actor_user_id=NEW.actor_user_id
 AND s.actor_user_id=s.approver_user_id
 AND s.amount_jpy=(SELECT COALESCE(SUM(a.amount_jpy),0)
  FROM family_card_settlement_allocations a
  WHERE a.homeflow_request_id=s.homeflow_request_id))
 BEGIN SELECT RAISE(ABORT,'CARD_SETTLEMENT_ALLOCATION_TOTAL_OR_AUDIT'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_card_settlement_audit_no_update
 BEFORE UPDATE ON family_card_settlement_audit
 BEGIN SELECT RAISE(ABORT,'CARD_SETTLEMENT_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_card_settlement_audit_no_delete
 BEFORE DELETE ON family_card_settlement_audit
 BEGIN SELECT RAISE(ABORT,'CARD_SETTLEMENT_AUDIT_IMMUTABLE'); END;
-- Canonical card expense must not be edited after its liability was recorded.
CREATE TRIGGER IF NOT EXISTS trg_family_card_purchase_entry_no_update
 BEFORE UPDATE ON entries
 WHEN EXISTS(SELECT 1 FROM family_card_purchase_applied p WHERE p.entry_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'CARD_PURCHASE_ENTRY_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_card_purchase_entry_no_delete
 BEFORE DELETE ON entries
 WHEN EXISTS(SELECT 1 FROM family_card_purchase_applied p WHERE p.entry_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'CARD_PURCHASE_ENTRY_IMMUTABLE'); END;

INSERT OR IGNORE INTO schema_migrations(version,description)
 VALUES('schema-0032-card-bank-settlement-foundation',
  'Draft bank debit evidence, approved transfer, allocated card liability and audit constraints');
