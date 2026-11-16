-- 0044 DRAFT ONLY. Internal, owner-reviewed SBI CASH investment ledger.
-- No broker API, no automatic legacy holdings or NAV import, no production migration.
-- A transfer entry, verified bank debit, immutable trade lot and actor audit must share
-- one SQLite D1 transaction. All new lots are excluded from tracked assets until reconciliation.
CREATE TABLE IF NOT EXISTS family_sbi_cash_intents (
 request_id TEXT PRIMARY KEY CHECK(length(request_id)=32),
 household_id TEXT NOT NULL,
 requester_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 bank_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 bank_version INTEGER NOT NULL CHECK(bank_version>=1),
 securities_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 securities_version INTEGER NOT NULL CHECK(securities_version>=1),
 kind TEXT NOT NULL CHECK(kind IN ('tsumitate','additional')),
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 payload_cipher TEXT NOT NULL,payload_iv TEXT NOT NULL,
 idempotency_hash TEXT NOT NULL UNIQUE CHECK(length(idempotency_hash)=64),
 status TEXT NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','submitted','cancelled')),
 homeflow_approval_id TEXT UNIQUE,
 created_at INTEGER NOT NULL CHECK(created_at>0),
 expires_at INTEGER NOT NULL CHECK(expires_at>created_at),
 submitted_at INTEGER,
 CHECK(bank_account_id<>securities_account_id)
);
CREATE INDEX IF NOT EXISTS idx_sbi_cash_intents_member
 ON family_sbi_cash_intents(household_id,requester_user_id,created_at DESC);
CREATE TRIGGER IF NOT EXISTS trg_sbi_cash_intent_owner BEFORE INSERT ON family_sbi_cash_intents
WHEN NOT EXISTS(
 SELECT 1 FROM family_financial_accounts bank
 JOIN family_financial_accounts securities ON securities.account_id=NEW.securities_account_id
 JOIN homeflow_identity_links actor ON actor.user_id=NEW.requester_user_id
 WHERE bank.account_id=NEW.bank_account_id
 AND bank.account_kind='bank' AND securities.account_kind='securities'
 AND bank.origin='member_created' AND securities.origin='member_created'
 AND bank.is_archived=0 AND securities.is_archived=0
 AND bank.version=NEW.bank_version AND securities.version=NEW.securities_version
 AND bank.household_id=NEW.household_id AND securities.household_id=NEW.household_id
 AND bank.owner_user_id=NEW.requester_user_id AND securities.owner_user_id=NEW.requester_user_id
 AND actor.household_id=NEW.household_id AND actor.role='member' AND actor.state='active')
BEGIN SELECT RAISE(ABORT,'SBI_CASH_OWNER_OR_VERSION'); END;
CREATE TRIGGER IF NOT EXISTS trg_sbi_cash_intent_immutable BEFORE UPDATE OF
 request_id,household_id,requester_user_id,bank_account_id,bank_version,
 securities_account_id,securities_version,kind,payload_sha256,payload_cipher,
 payload_iv,idempotency_hash,created_at,expires_at
 ON family_sbi_cash_intents
 BEGIN SELECT RAISE(ABORT,'SBI_CASH_INTENT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_sbi_cash_intent_transition BEFORE UPDATE OF status ON family_sbi_cash_intents
WHEN NOT(OLD.status='prepared' AND NEW.status IN ('submitted','cancelled'))
BEGIN SELECT RAISE(ABORT,'SBI_CASH_INTENT_STATE'); END;
CREATE TRIGGER IF NOT EXISTS trg_sbi_cash_intent_no_delete BEFORE DELETE ON family_sbi_cash_intents
BEGIN SELECT RAISE(ABORT,'SBI_CASH_INTENT_IMMUTABLE'); END;
CREATE TABLE IF NOT EXISTS family_sbi_cash_bank_evidence (
 evidence_id TEXT PRIMARY KEY CHECK(length(evidence_id)=32),
 household_id TEXT NOT NULL,
 bank_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 bank_version INTEGER NOT NULL CHECK(bank_version>=1),
 reference_hash TEXT NOT NULL CHECK(length(reference_hash)=64),
 debit_date TEXT NOT NULL CHECK(length(debit_date)=10),
 amount_jpy INTEGER NOT NULL CHECK(amount_jpy BETWEEN 1 AND 10000000),
 evidence_kind TEXT NOT NULL CHECK(evidence_kind='owner_confirmed_statement'),
 recorded_at INTEGER NOT NULL CHECK(recorded_at>0),
 UNIQUE(bank_account_id,reference_hash)
);
CREATE TRIGGER IF NOT EXISTS trg_sbi_cash_evidence_guard BEFORE INSERT ON family_sbi_cash_bank_evidence
WHEN NOT EXISTS(SELECT 1 FROM family_financial_accounts a WHERE a.account_id=NEW.bank_account_id
 AND a.version=NEW.bank_version AND a.account_kind='bank' AND a.origin='member_created'
 AND a.is_archived=0 AND a.household_id=NEW.household_id)
 OR EXISTS(SELECT 1 FROM family_card_bank_debit_evidence c WHERE c.bank_account_id=NEW.bank_account_id
 AND c.reference_hash=NEW.reference_hash)
BEGIN SELECT RAISE(ABORT,'SBI_CASH_EVIDENCE_DUPLICATE_OR_INVALID'); END;
-- The same owner-confirmed bank statement may never fund a card payment as well.
CREATE TRIGGER IF NOT EXISTS trg_sbi_cash_no_later_card_duplicate
 BEFORE INSERT ON family_card_bank_debit_evidence
 WHEN EXISTS(SELECT 1 FROM family_sbi_cash_bank_evidence c WHERE c.bank_account_id=NEW.bank_account_id
  AND c.reference_hash=NEW.reference_hash)
 BEGIN SELECT RAISE(ABORT,'SBI_CASH_BANK_DEBIT_ALREADY_USED'); END;
CREATE TRIGGER IF NOT EXISTS trg_sbi_cash_evidence_no_update BEFORE UPDATE ON family_sbi_cash_bank_evidence
BEGIN SELECT RAISE(ABORT,'SBI_CASH_EVIDENCE_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_sbi_cash_evidence_no_delete BEFORE DELETE ON family_sbi_cash_bank_evidence
BEGIN SELECT RAISE(ABORT,'SBI_CASH_EVIDENCE_IMMUTABLE'); END;
CREATE TABLE IF NOT EXISTS family_sbi_cash_applied (
 homeflow_request_id TEXT PRIMARY KEY,
 proposal_id TEXT NOT NULL UNIQUE REFERENCES family_sbi_cash_intents(request_id) ON DELETE RESTRICT,
 household_id TEXT NOT NULL,
 requester_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 approver_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 actor_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 bank_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 bank_version INTEGER NOT NULL,
 securities_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 securities_version INTEGER NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('tsumitate','additional')),
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 evidence_id TEXT NOT NULL UNIQUE REFERENCES family_sbi_cash_bank_evidence(evidence_id) ON DELETE RESTRICT,
 transfer_entry_id INTEGER NOT NULL UNIQUE REFERENCES entries(id) ON DELETE RESTRICT,
 amount_jpy INTEGER NOT NULL CHECK(amount_jpy BETWEEN 1 AND 10000000),
 debit_date TEXT NOT NULL,trade_date TEXT NOT NULL,effective_date TEXT NOT NULL,
 applied_at INTEGER NOT NULL CHECK(applied_at>0)
);
CREATE INDEX IF NOT EXISTS idx_sbi_cash_applied_bank ON family_sbi_cash_applied(household_id,bank_account_id,debit_date);
CREATE TRIGGER IF NOT EXISTS trg_sbi_cash_applied_guard BEFORE INSERT ON family_sbi_cash_applied
WHEN NOT EXISTS(
 SELECT 1 FROM family_sbi_cash_intents p
 JOIN family_sbi_cash_bank_evidence d ON d.evidence_id=NEW.evidence_id
 JOIN entries e ON e.id=NEW.transfer_entry_id
 JOIN family_financial_accounts bank ON bank.account_id=NEW.bank_account_id
 JOIN family_financial_accounts securities ON securities.account_id=NEW.securities_account_id
 JOIN homeflow_identity_links requester ON requester.user_id=NEW.requester_user_id
 JOIN homeflow_identity_links approver ON approver.user_id=NEW.approver_user_id
 WHERE p.request_id=NEW.proposal_id AND p.homeflow_approval_id=NEW.homeflow_request_id
 AND p.status='submitted' AND p.expires_at>NEW.applied_at AND p.payload_sha256=NEW.payload_sha256
 AND p.household_id=NEW.household_id AND p.requester_user_id=NEW.requester_user_id
 AND p.bank_account_id=NEW.bank_account_id AND p.securities_account_id=NEW.securities_account_id
 AND p.bank_version=NEW.bank_version AND p.securities_version=NEW.securities_version
 AND p.kind=NEW.kind
 AND bank.version=NEW.bank_version AND securities.version=NEW.securities_version
 AND bank.account_kind='bank' AND securities.account_kind='securities'
 AND bank.origin='member_created' AND securities.origin='member_created'
 AND bank.is_archived=0 AND securities.is_archived=0 AND bank.opening_balance>=0
 AND bank.owner_user_id=NEW.requester_user_id AND securities.owner_user_id=NEW.requester_user_id
 AND bank.household_id=NEW.household_id AND securities.household_id=NEW.household_id
 AND requester.household_id=NEW.household_id AND requester.role='member' AND requester.state='active'
 AND approver.household_id=NEW.household_id AND approver.role='owner' AND approver.state='active'
 AND NEW.actor_user_id=NEW.approver_user_id AND NEW.approver_user_id<>NEW.requester_user_id
 AND d.household_id=NEW.household_id AND d.bank_account_id=NEW.bank_account_id
 AND d.bank_version=NEW.bank_version AND d.amount_jpy=NEW.amount_jpy
 AND d.debit_date=NEW.debit_date
 AND e.amount=NEW.amount_jpy AND e.date=NEW.debit_date AND e.type='transfer'
 AND e.client_request_id='hfsbicash:'||NEW.homeflow_request_id
 AND e.family_account_id=NEW.bank_account_id
 AND e.family_transfer_target_account_id=NEW.securities_account_id
 AND e.transfer_target='sbi:'||NEW.securities_account_id
 AND e.payment_source='bank:'||NEW.bank_account_id
 AND e.transfer_applied=1 AND e.transfer_date=NEW.effective_date
 AND NEW.debit_date<=NEW.trade_date AND NEW.trade_date<=NEW.effective_date
 -- All stable-account bank inflows and outflows, including this new transfer,
 -- participate in the same writer balance check; never trust external balance.
 AND bank.opening_balance+
   COALESCE((SELECT SUM(CASE WHEN x.type='income' AND x.family_account_id=NEW.bank_account_id
      THEN x.amount WHEN x.type IN ('expense','transfer') AND x.family_account_id=NEW.bank_account_id
      THEN -x.amount WHEN x.type='transfer' AND x.family_transfer_target_account_id=NEW.bank_account_id
      AND x.transfer_applied=1 THEN x.amount ELSE 0 END)
      FROM entries x WHERE x.family_account_id=NEW.bank_account_id OR
      x.family_transfer_target_account_id=NEW.bank_account_id),0)>=0
 )
BEGIN SELECT RAISE(ABORT,'SBI_CASH_ATOMIC_DEBIT_OR_VERSION_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS trg_sbi_cash_applied_no_update BEFORE UPDATE ON family_sbi_cash_applied
BEGIN SELECT RAISE(ABORT,'SBI_CASH_APPLIED_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_sbi_cash_applied_no_delete BEFORE DELETE ON family_sbi_cash_applied
BEGIN SELECT RAISE(ABORT,'SBI_CASH_APPLIED_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_sbi_cash_entry_no_update BEFORE UPDATE ON entries
WHEN EXISTS(SELECT 1 FROM family_sbi_cash_applied a WHERE a.transfer_entry_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'SBI_CASH_ENTRY_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_sbi_cash_entry_no_delete BEFORE DELETE ON entries
WHEN EXISTS(SELECT 1 FROM family_sbi_cash_applied a WHERE a.transfer_entry_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'SBI_CASH_ENTRY_IMMUTABLE'); END;
CREATE TABLE IF NOT EXISTS family_sbi_cash_lots (
 homeflow_request_id TEXT PRIMARY KEY REFERENCES family_sbi_cash_applied(homeflow_request_id) ON DELETE RESTRICT,
 household_id TEXT NOT NULL,
 owner_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 securities_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 kind TEXT NOT NULL CHECK(kind IN ('tsumitate','additional')),
 fund_code TEXT NOT NULL CHECK(length(fund_code)=8 AND fund_code NOT GLOB '*[^A-Z0-9]*'),
 account_type TEXT NOT NULL CHECK(account_type IN ('growth','tsumitate')),
 confirmed_units INTEGER NOT NULL CHECK(confirmed_units BETWEEN 1 AND 1000000000000),
 acquisition_cost_jpy INTEGER NOT NULL CHECK(acquisition_cost_jpy BETWEEN 1 AND 10000000),
 broker_reference_hash TEXT NOT NULL UNIQUE CHECK(length(broker_reference_hash)=64),
 trade_date TEXT NOT NULL,effective_date TEXT NOT NULL,
 actor_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 recorded_at INTEGER NOT NULL CHECK(recorded_at>0),
 evidence_kind TEXT NOT NULL DEFAULT 'user_attested_broker_execution'
 CHECK(evidence_kind='user_attested_broker_execution')
);
CREATE INDEX IF NOT EXISTS idx_sbi_cash_position ON family_sbi_cash_lots(
 household_id,securities_account_id,fund_code,account_type,effective_date);
CREATE TRIGGER IF NOT EXISTS trg_sbi_cash_lot_match BEFORE INSERT ON family_sbi_cash_lots
WHEN NOT EXISTS(
 SELECT 1 FROM family_sbi_cash_applied a JOIN family_sbi_cash_intents i ON i.request_id=a.proposal_id
 JOIN family_financial_accounts s ON s.account_id=NEW.securities_account_id
 WHERE a.homeflow_request_id=NEW.homeflow_request_id
 AND a.household_id=NEW.household_id AND a.requester_user_id=NEW.owner_user_id
 AND a.actor_user_id=NEW.actor_user_id AND a.securities_account_id=NEW.securities_account_id
 AND a.kind=NEW.kind AND a.amount_jpy=NEW.acquisition_cost_jpy
 AND a.trade_date=NEW.trade_date AND a.effective_date=NEW.effective_date
 AND a.applied_at=NEW.recorded_at AND s.version=a.securities_version AND s.is_archived=0
 AND s.owner_user_id=NEW.owner_user_id AND s.household_id=NEW.household_id
 ) OR EXISTS(SELECT 1 FROM family_sbi_point_lots p WHERE p.broker_reference_hash=NEW.broker_reference_hash)
BEGIN SELECT RAISE(ABORT,'SBI_CASH_LOT_OR_BROKER_DUPLICATE'); END;
CREATE TRIGGER IF NOT EXISTS trg_sbi_point_no_cash_trade_reuse BEFORE INSERT ON family_sbi_point_lots
WHEN EXISTS(SELECT 1 FROM family_sbi_cash_lots c WHERE c.broker_reference_hash=NEW.broker_reference_hash)
BEGIN SELECT RAISE(ABORT,'SBI_BROKER_TRADE_ALREADY_RECORDED_AS_CASH'); END;
CREATE TRIGGER IF NOT EXISTS trg_sbi_cash_lot_no_update BEFORE UPDATE ON family_sbi_cash_lots
BEGIN SELECT RAISE(ABORT,'SBI_CASH_LOT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_sbi_cash_lot_no_delete BEFORE DELETE ON family_sbi_cash_lots
BEGIN SELECT RAISE(ABORT,'SBI_CASH_LOT_IMMUTABLE'); END;
CREATE TABLE IF NOT EXISTS family_sbi_cash_audit (
 event_id TEXT PRIMARY KEY,
 homeflow_request_id TEXT NOT NULL UNIQUE REFERENCES family_sbi_cash_applied(homeflow_request_id) ON DELETE RESTRICT,
 requester_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id),
 approver_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id),
 actor_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id),
 action TEXT NOT NULL CHECK(action='sbi_cash_purchase_applied'),
 created_at INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS trg_sbi_cash_audit_guard BEFORE INSERT ON family_sbi_cash_audit
WHEN NOT EXISTS(SELECT 1 FROM family_sbi_cash_applied a JOIN family_sbi_cash_lots l
 ON l.homeflow_request_id=a.homeflow_request_id WHERE a.homeflow_request_id=NEW.homeflow_request_id
 AND a.requester_user_id=NEW.requester_user_id AND a.approver_user_id=NEW.approver_user_id
 AND a.actor_user_id=NEW.actor_user_id AND l.actor_user_id=NEW.actor_user_id
 AND a.applied_at=NEW.created_at)
BEGIN SELECT RAISE(ABORT,'SBI_CASH_AUDIT_MISSING_COUNTERPART'); END;
CREATE TRIGGER IF NOT EXISTS trg_sbi_cash_audit_no_update BEFORE UPDATE ON family_sbi_cash_audit
BEGIN SELECT RAISE(ABORT,'SBI_CASH_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_sbi_cash_audit_no_delete BEFORE DELETE ON family_sbi_cash_audit
BEGIN SELECT RAISE(ABORT,'SBI_CASH_AUDIT_IMMUTABLE'); END;
INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(
 'schema-0044-sbi-cash-purchases','UNDEPLOYED SBI statement-confirmed cash purchase atomic evidence, entry, lot and audit; excluded from legacy assets');