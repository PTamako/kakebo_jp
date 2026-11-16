-- 0054 DRAFT: one member-owned fixed fee OR SBI tsumitate per approved
-- HomeFlow policy/month, bank debit already POSTED, broker execution attested.
-- No bank wire/order/API; receipts include no speculative NAV or market value.
-- Source & target accounting is one Kakeibo D1 transaction, NOT global D1 ACID.
CREATE TABLE IF NOT EXISTS family_recurring_execution_intents(
 occurrence_id TEXT PRIMARY KEY CHECK(length(occurrence_id)=32 AND occurrence_id NOT GLOB '*[^0-9a-f]*'),
 policy_id TEXT NOT NULL CHECK(length(policy_id)=36),
 household_id TEXT NOT NULL,
 member_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 plan_resource_id TEXT NOT NULL REFERENCES family_member_recurring_plans(plan_resource_id) ON DELETE RESTRICT,
 plan_payload_sha256 TEXT NOT NULL CHECK(length(plan_payload_sha256)=64),
 source_account_version INTEGER NOT NULL CHECK(source_account_version>=1),
 securities_version INTEGER,
 bank_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 securities_account_id TEXT REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 period_key TEXT NOT NULL CHECK(length(period_key)=7),
 due_date TEXT NOT NULL CHECK(length(due_date)=10),
 amount_jpy INTEGER NOT NULL CHECK(amount_jpy BETWEEN 1 AND 10000000),
 debit_date TEXT NOT NULL CHECK(length(debit_date)=10),
 bank_reference_hash TEXT NOT NULL CHECK(length(bank_reference_hash)=64),
 fund_code TEXT,
 confirmed_units INTEGER,
 broker_reference_hash TEXT,
 trade_date TEXT,
 effective_date TEXT,
 entry_intent_sha256 TEXT NOT NULL CHECK(length(entry_intent_sha256)=64),
 payload_cipher TEXT NOT NULL,payload_iv TEXT NOT NULL,
 created_at INTEGER NOT NULL CHECK(created_at>0),
 CHECK(period_key=substr(due_date,1,7) AND debit_date>=due_date),
 CHECK((securities_account_id IS NULL AND securities_version IS NULL
   AND fund_code IS NULL AND confirmed_units IS NULL
   AND broker_reference_hash IS NULL AND trade_date IS NULL AND effective_date IS NULL)
 OR (securities_account_id IS NOT NULL AND securities_version>=1
   AND length(fund_code)=8 AND confirmed_units BETWEEN 1 AND 1000000000000
   AND length(broker_reference_hash)=64 AND trade_date IS NOT NULL
   AND effective_date IS NOT NULL AND debit_date<=trade_date AND trade_date<=effective_date)),
 UNIQUE(plan_resource_id,period_key),
 UNIQUE(bank_account_id,bank_reference_hash),
 UNIQUE(securities_account_id,broker_reference_hash),
 UNIQUE(entry_intent_sha256,member_user_id)
);
CREATE INDEX IF NOT EXISTS idx_recurring_kakeibo_intents_member
 ON family_recurring_execution_intents(household_id,member_user_id,period_key DESC);
CREATE TRIGGER IF NOT EXISTS trg_recurring_execution_intent_owner
BEFORE INSERT ON family_recurring_execution_intents
WHEN NOT EXISTS(
 SELECT 1 FROM family_member_recurring_plans p
 JOIN family_financial_accounts b ON b.account_id=p.bank_account_id
 JOIN homeflow_identity_links m ON m.user_id=NEW.member_user_id
 WHERE p.plan_resource_id=NEW.plan_resource_id AND p.household_id=NEW.household_id
 AND p.owner_user_id=NEW.member_user_id AND p.plan_payload_sha256=NEW.plan_payload_sha256
 AND p.bank_account_id=NEW.bank_account_id AND p.bank_version=NEW.source_account_version
 AND p.securities_account_id IS NEW.securities_account_id
 AND p.securities_version IS NEW.securities_version
 AND p.amount_jpy=NEW.amount_jpy AND p.due_day=CAST(substr(NEW.due_date,9,2) AS INTEGER)
 AND p.start_month<=NEW.period_key AND p.end_month>=NEW.period_key AND p.status='active'
 AND m.household_id=NEW.household_id AND m.state='active' AND m.role='member'
 AND b.household_id=NEW.household_id AND b.owner_user_id=NEW.member_user_id
 AND b.account_kind='bank' AND b.origin='member_created' AND b.is_archived=0
 AND b.version=NEW.source_account_version
 AND ((p.plan_type='fixed_cost' AND NEW.securities_account_id IS NULL
   AND EXISTS(SELECT 1 FROM recurring_plans legacy
    WHERE legacy.id=p.legacy_recurring_plan_id AND legacy.enabled=1
    AND legacy.posting_mode='manual' AND legacy.amount=p.amount_jpy
    AND legacy.day=p.due_day AND legacy.category=p.category
    AND legacy.name=p.merchant
    AND legacy.payment_source='bank:'||p.bank_account_id))
  OR (p.plan_type='sbi_tsumitate' AND NEW.securities_account_id IS NOT NULL
   AND NEW.fund_code=p.fund_code AND NEW.securities_version=p.securities_version
   AND EXISTS(SELECT 1 FROM family_financial_accounts sec
    WHERE sec.account_id=NEW.securities_account_id AND sec.owner_user_id=NEW.member_user_id
    AND sec.household_id=NEW.household_id AND sec.account_kind='securities'
    AND sec.origin='member_created' AND sec.is_archived=0
    AND sec.version=NEW.securities_version)))
) OR NEW.debit_date>date(NEW.created_at/1000,'unixepoch','+9 hours')
  OR NEW.debit_date>date(NEW.due_date,'+7 days')
BEGIN SELECT RAISE(ABORT,'RECURRING_EXECUTION_PLAN_OR_POSTED_DEBIT_INVALID'); END;
CREATE TRIGGER IF NOT EXISTS trg_recurring_execution_intent_immutable_update
BEFORE UPDATE ON family_recurring_execution_intents
BEGIN SELECT RAISE(ABORT,'RECURRING_EXECUTION_INTENT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_recurring_execution_intent_immutable_delete
BEFORE DELETE ON family_recurring_execution_intents
BEGIN SELECT RAISE(ABORT,'RECURRING_EXECUTION_INTENT_IMMUTABLE'); END;

CREATE TABLE IF NOT EXISTS family_recurring_execution_applied(
 occurrence_id TEXT PRIMARY KEY REFERENCES family_recurring_execution_intents(occurrence_id) ON DELETE RESTRICT,
 policy_id TEXT NOT NULL,
 household_id TEXT NOT NULL,
 member_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 owner_authorizer_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 plan_resource_id TEXT NOT NULL REFERENCES family_member_recurring_plans(plan_resource_id),
 plan_type TEXT NOT NULL CHECK(plan_type IN('fixed_cost','sbi_tsumitate')),
 plan_payload_sha256 TEXT NOT NULL CHECK(length(plan_payload_sha256)=64),
 source_account_version INTEGER NOT NULL,
 period_key TEXT NOT NULL,
 due_date TEXT NOT NULL,
 amount_jpy INTEGER NOT NULL CHECK(amount_jpy BETWEEN 1 AND 10000000),
 entry_intent_sha256 TEXT NOT NULL CHECK(length(entry_intent_sha256)=64),
 bank_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id),
 bank_reference_hash TEXT NOT NULL CHECK(length(bank_reference_hash)=64),
 debit_date TEXT NOT NULL,
 securities_account_id TEXT REFERENCES family_financial_accounts(account_id),
 securities_version INTEGER,
 fund_code TEXT,
 confirmed_units INTEGER,
 broker_reference_hash TEXT,
 trade_date TEXT,
 effective_date TEXT,
 target_entry_id INTEGER NOT NULL UNIQUE REFERENCES entries(id) ON DELETE RESTRICT,
 target_journal_sha256 TEXT NOT NULL CHECK(length(target_journal_sha256)=64),
 target_applied_at INTEGER NOT NULL CHECK(target_applied_at>0),
 external_bank_verified INTEGER NOT NULL DEFAULT 0 CHECK(external_bank_verified=0),
 external_broker_verified INTEGER NOT NULL DEFAULT 0 CHECK(external_broker_verified=0),
 UNIQUE(household_id,plan_resource_id,period_key),
 UNIQUE(bank_account_id,bank_reference_hash),
 UNIQUE(securities_account_id,broker_reference_hash),
 CHECK(member_user_id<>owner_authorizer_user_id),
 CHECK((plan_type='fixed_cost' AND securities_account_id IS NULL
  AND securities_version IS NULL AND broker_reference_hash IS NULL
  AND confirmed_units IS NULL AND fund_code IS NULL)
  OR (plan_type='sbi_tsumitate' AND securities_account_id IS NOT NULL
   AND securities_version>=1 AND broker_reference_hash IS NOT NULL
   AND confirmed_units BETWEEN 1 AND 1000000000000 AND length(fund_code)=8))
);
CREATE INDEX IF NOT EXISTS idx_recurring_applied_household
 ON family_recurring_execution_applied(household_id,member_user_id,period_key DESC);
CREATE TRIGGER IF NOT EXISTS trg_recurring_execution_applied_guard
BEFORE INSERT ON family_recurring_execution_applied
WHEN NOT EXISTS(
 SELECT 1 FROM family_recurring_execution_intents i
 JOIN family_member_recurring_plans plan ON plan.plan_resource_id=i.plan_resource_id
 JOIN entries e ON e.id=NEW.target_entry_id
 JOIN homeflow_identity_links m ON m.user_id=NEW.member_user_id
 JOIN homeflow_identity_links owner ON owner.user_id=NEW.owner_authorizer_user_id
 JOIN family_financial_accounts bank ON bank.account_id=NEW.bank_account_id
 WHERE i.occurrence_id=NEW.occurrence_id AND i.policy_id=NEW.policy_id
 AND i.household_id=NEW.household_id AND i.member_user_id=NEW.member_user_id
 AND i.plan_resource_id=NEW.plan_resource_id AND i.plan_payload_sha256=NEW.plan_payload_sha256
 AND i.source_account_version=NEW.source_account_version
 AND i.period_key=NEW.period_key AND i.due_date=NEW.due_date
 AND i.amount_jpy=NEW.amount_jpy AND i.entry_intent_sha256=NEW.entry_intent_sha256
 AND i.bank_account_id=NEW.bank_account_id AND i.bank_reference_hash=NEW.bank_reference_hash
 AND i.debit_date=NEW.debit_date AND i.securities_account_id IS NEW.securities_account_id
 AND i.securities_version IS NEW.securities_version
 AND i.fund_code IS NEW.fund_code AND i.confirmed_units IS NEW.confirmed_units
 AND i.broker_reference_hash IS NEW.broker_reference_hash
 AND i.trade_date IS NEW.trade_date AND i.effective_date IS NEW.effective_date
 AND i.created_at<=NEW.target_applied_at
 AND plan.plan_type=NEW.plan_type AND plan.status='active'
 AND plan.household_id=NEW.household_id AND plan.owner_user_id=NEW.member_user_id
 AND plan.plan_payload_sha256=NEW.plan_payload_sha256
 AND plan.bank_version=NEW.source_account_version
 AND plan.bank_account_id=NEW.bank_account_id
 AND m.household_id=NEW.household_id AND m.role='member' AND m.state='active'
 AND owner.household_id=NEW.household_id AND owner.role='owner' AND owner.state='active'
 AND bank.version=NEW.source_account_version AND bank.is_archived=0
 AND bank.account_kind='bank' AND bank.origin='member_created'
 AND bank.household_id=NEW.household_id AND bank.owner_user_id=NEW.member_user_id
 AND e.client_request_id='hfrecurring:'||NEW.occurrence_id
 AND e.amount=NEW.amount_jpy AND e.date=NEW.debit_date
 AND e.payment_source='bank:'||NEW.bank_account_id
 AND e.family_account_id=NEW.bank_account_id
 AND (
  (NEW.plan_type='fixed_cost' AND e.type='expense'
   AND e.family_transfer_target_account_id IS NULL)
  OR (NEW.plan_type='sbi_tsumitate' AND e.type='transfer'
   AND e.transfer_applied=1 AND e.transfer_date=NEW.effective_date
   AND e.family_transfer_target_account_id=NEW.securities_account_id
   AND e.transfer_target='sbi:'||NEW.securities_account_id
   AND EXISTS(SELECT 1 FROM family_financial_accounts sec
    WHERE sec.account_id=NEW.securities_account_id
    AND sec.household_id=NEW.household_id AND sec.owner_user_id=NEW.member_user_id
    AND sec.account_kind='securities' AND sec.origin='member_created'
    AND sec.is_archived=0 AND sec.version=NEW.securities_version))
 )
 AND bank.opening_balance+COALESCE((
  SELECT SUM(CASE WHEN x.type='income' AND x.family_account_id=NEW.bank_account_id
    THEN x.amount WHEN x.type IN('expense','transfer') AND x.family_account_id=NEW.bank_account_id
    THEN -x.amount WHEN x.type='transfer' AND x.family_transfer_target_account_id=NEW.bank_account_id
      AND x.transfer_applied=1 THEN x.amount ELSE 0 END)
  FROM entries x WHERE x.family_account_id=NEW.bank_account_id
    OR x.family_transfer_target_account_id=NEW.bank_account_id
 ),0)>=0
)
OR EXISTS(SELECT 1 FROM family_sbi_cash_bank_evidence d
 WHERE d.bank_account_id=NEW.bank_account_id AND d.reference_hash=NEW.bank_reference_hash)
OR EXISTS(SELECT 1 FROM family_card_bank_debit_evidence d
 WHERE d.bank_account_id=NEW.bank_account_id AND d.reference_hash=NEW.bank_reference_hash)
OR EXISTS(SELECT 1 FROM family_sbi_cash_refund_evidence d
 WHERE d.bank_account_id=NEW.bank_account_id AND d.bank_refund_hash=NEW.bank_reference_hash)
OR EXISTS(SELECT 1 FROM family_bank_transfer_posted_evidence d
 WHERE (d.source_account_id=NEW.bank_account_id AND d.source_reference_hash=NEW.bank_reference_hash)
 OR (d.target_account_id=NEW.bank_account_id AND d.target_reference_hash=NEW.bank_reference_hash))
OR EXISTS(SELECT 1 FROM family_cross_bank_journal d
 WHERE (d.source_account_id=NEW.bank_account_id AND d.source_reference_hash=NEW.bank_reference_hash)
 OR (d.target_account_id=NEW.bank_account_id AND d.credit_reference_hash=NEW.bank_reference_hash))
BEGIN SELECT RAISE(ABORT,'RECURRING_EXECUTION_DOUBLE_JOURNAL_OR_BANK_REFERENCE_INVALID'); END;
CREATE TRIGGER IF NOT EXISTS trg_recurring_execution_applied_immutable_update
BEFORE UPDATE ON family_recurring_execution_applied
BEGIN SELECT RAISE(ABORT,'RECURRING_EXECUTION_JOURNAL_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_recurring_execution_applied_immutable_delete
BEFORE DELETE ON family_recurring_execution_applied
BEGIN SELECT RAISE(ABORT,'RECURRING_EXECUTION_JOURNAL_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_recurring_execution_entry_no_update
BEFORE UPDATE ON entries
WHEN EXISTS(SELECT 1 FROM family_recurring_execution_applied r WHERE r.target_entry_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'RECURRING_EXECUTION_ENTRY_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_recurring_execution_entry_no_delete
BEFORE DELETE ON entries
WHEN EXISTS(SELECT 1 FROM family_recurring_execution_applied r WHERE r.target_entry_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'RECURRING_EXECUTION_ENTRY_IMMUTABLE'); END;
-- New SBI lot source, separate from existing legacy/global investment_holdings.
-- No market valuation or NAV is fabricated from member attestation.
CREATE TABLE IF NOT EXISTS family_recurring_sbi_lots(
 occurrence_id TEXT PRIMARY KEY REFERENCES family_recurring_execution_applied(occurrence_id) ON DELETE RESTRICT,
 household_id TEXT NOT NULL,
 owner_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id),
 securities_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id),
 fund_code TEXT NOT NULL CHECK(length(fund_code)=8 AND fund_code NOT GLOB '*[^A-Z0-9]*'),
 account_type TEXT NOT NULL CHECK(account_type='tsumitate'),
 confirmed_units INTEGER NOT NULL CHECK(confirmed_units BETWEEN 1 AND 1000000000000),
 acquisition_cost_jpy INTEGER NOT NULL CHECK(acquisition_cost_jpy BETWEEN 1 AND 10000000),
 broker_reference_hash TEXT NOT NULL UNIQUE CHECK(length(broker_reference_hash)=64),
 trade_date TEXT NOT NULL,effective_date TEXT NOT NULL,
 recorded_at INTEGER NOT NULL CHECK(recorded_at>0),
 institution_broker_reconciled INTEGER NOT NULL DEFAULT 0 CHECK(institution_broker_reconciled=0),
 included_in_tracked_assets INTEGER NOT NULL DEFAULT 0 CHECK(included_in_tracked_assets=0)
);
CREATE INDEX IF NOT EXISTS idx_recurring_sbi_lots_household
 ON family_recurring_sbi_lots(household_id,securities_account_id,fund_code,effective_date);
CREATE TRIGGER IF NOT EXISTS trg_recurring_sbi_lot_guard
BEFORE INSERT ON family_recurring_sbi_lots
WHEN NOT EXISTS(SELECT 1 FROM family_recurring_execution_applied a
 WHERE a.occurrence_id=NEW.occurrence_id AND a.household_id=NEW.household_id
 AND a.member_user_id=NEW.owner_user_id AND a.plan_type='sbi_tsumitate'
 AND a.securities_account_id=NEW.securities_account_id
 AND a.fund_code=NEW.fund_code
 AND a.confirmed_units=NEW.confirmed_units AND a.amount_jpy=NEW.acquisition_cost_jpy
 AND a.broker_reference_hash=NEW.broker_reference_hash
 AND a.trade_date=NEW.trade_date AND a.effective_date=NEW.effective_date
 AND a.target_applied_at=NEW.recorded_at)
OR EXISTS(SELECT 1 FROM family_sbi_cash_lots l WHERE l.broker_reference_hash=NEW.broker_reference_hash)
OR EXISTS(SELECT 1 FROM family_sbi_point_lots l WHERE l.broker_reference_hash=NEW.broker_reference_hash)
BEGIN SELECT RAISE(ABORT,'RECURRING_SBI_LOT_OR_BROKER_DUPLICATE'); END;
CREATE TRIGGER IF NOT EXISTS trg_recurring_sbi_lot_no_update
BEFORE UPDATE ON family_recurring_sbi_lots
BEGIN SELECT RAISE(ABORT,'RECURRING_SBI_LOT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_recurring_sbi_lot_no_delete
BEFORE DELETE ON family_recurring_sbi_lots
BEGIN SELECT RAISE(ABORT,'RECURRING_SBI_LOT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_recurring_sbi_legacy_cash_reuse
BEFORE INSERT ON family_sbi_cash_lots
WHEN EXISTS(SELECT 1 FROM family_recurring_sbi_lots l
 WHERE l.broker_reference_hash=NEW.broker_reference_hash)
BEGIN SELECT RAISE(ABORT,'RECURRING_SBI_BROKER_ALREADY_USED'); END;
CREATE TRIGGER IF NOT EXISTS trg_recurring_sbi_legacy_points_reuse
BEFORE INSERT ON family_sbi_point_lots
WHEN EXISTS(SELECT 1 FROM family_recurring_sbi_lots l
 WHERE l.broker_reference_hash=NEW.broker_reference_hash)
BEGIN SELECT RAISE(ABORT,'RECURRING_SBI_BROKER_ALREADY_USED'); END;
CREATE TABLE IF NOT EXISTS family_recurring_execution_audit(
 audit_id TEXT PRIMARY KEY CHECK(length(audit_id)=32),
 occurrence_id TEXT NOT NULL UNIQUE REFERENCES family_recurring_execution_applied(occurrence_id) ON DELETE RESTRICT,
 member_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id),
 owner_authorizer_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id),
 actor_type TEXT NOT NULL CHECK(actor_type='policy_authorized_internal_service'),
 action TEXT NOT NULL CHECK(action IN('fixed_cost_posted','sbi_tsumitate_posted')),
 occurred_at INTEGER NOT NULL CHECK(occurred_at>0)
);
CREATE TRIGGER IF NOT EXISTS trg_recurring_execution_audit_guard
BEFORE INSERT ON family_recurring_execution_audit
WHEN NOT EXISTS(SELECT 1 FROM family_recurring_execution_applied a
 WHERE a.occurrence_id=NEW.occurrence_id AND a.member_user_id=NEW.member_user_id
 AND a.owner_authorizer_user_id=NEW.owner_authorizer_user_id
 AND a.target_applied_at=NEW.occurred_at
 AND NEW.action=CASE WHEN a.plan_type='fixed_cost'
  THEN 'fixed_cost_posted' ELSE 'sbi_tsumitate_posted' END)
BEGIN SELECT RAISE(ABORT,'RECURRING_AUDIT_COUNTERPART_UNKNOWN'); END;
CREATE TRIGGER IF NOT EXISTS trg_recurring_execution_audit_immutable_update
BEFORE UPDATE ON family_recurring_execution_audit
BEGIN SELECT RAISE(ABORT,'RECURRING_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_recurring_execution_audit_immutable_delete
BEFORE DELETE ON family_recurring_execution_audit
BEGIN SELECT RAISE(ABORT,'RECURRING_AUDIT_IMMUTABLE'); END;
-- Later old bank debit writers cannot reuse a recurring statement reference.
CREATE TRIGGER IF NOT EXISTS trg_recurring_no_later_sbi_bank_reuse
BEFORE INSERT ON family_sbi_cash_bank_evidence
WHEN EXISTS(SELECT 1 FROM family_recurring_execution_applied a
 WHERE a.bank_account_id=NEW.bank_account_id AND a.bank_reference_hash=NEW.reference_hash)
BEGIN SELECT RAISE(ABORT,'RECURRING_BANK_REFERENCE_ALREADY_USED'); END;
CREATE TRIGGER IF NOT EXISTS trg_recurring_no_later_card_bank_reuse
BEFORE INSERT ON family_card_bank_debit_evidence
WHEN EXISTS(SELECT 1 FROM family_recurring_execution_applied a
 WHERE a.bank_account_id=NEW.bank_account_id AND a.bank_reference_hash=NEW.reference_hash)
BEGIN SELECT RAISE(ABORT,'RECURRING_BANK_REFERENCE_ALREADY_USED'); END;
CREATE TRIGGER IF NOT EXISTS trg_recurring_no_later_bank_transfer_reuse
BEFORE INSERT ON family_bank_transfer_posted_evidence
WHEN EXISTS(SELECT 1 FROM family_recurring_execution_applied a
 WHERE (a.bank_account_id=NEW.source_account_id AND a.bank_reference_hash=NEW.source_reference_hash)
 OR (a.bank_account_id=NEW.target_account_id AND a.bank_reference_hash=NEW.target_reference_hash))
BEGIN SELECT RAISE(ABORT,'RECURRING_BANK_REFERENCE_ALREADY_USED'); END;
CREATE TRIGGER IF NOT EXISTS trg_recurring_no_later_cross_bank_reuse
BEFORE INSERT ON family_cross_bank_journal
WHEN EXISTS(SELECT 1 FROM family_recurring_execution_applied a
 WHERE (a.bank_account_id=NEW.source_account_id AND a.bank_reference_hash=NEW.source_reference_hash)
 OR (a.bank_account_id=NEW.target_account_id AND a.bank_reference_hash=NEW.credit_reference_hash))
BEGIN SELECT RAISE(ABORT,'RECURRING_BANK_REFERENCE_ALREADY_USED'); END;
CREATE TRIGGER IF NOT EXISTS trg_recurring_no_later_sbi_refund_reuse
BEFORE INSERT ON family_sbi_cash_refund_evidence
WHEN EXISTS(SELECT 1 FROM family_recurring_execution_applied a
 WHERE a.bank_account_id=NEW.bank_account_id AND a.bank_reference_hash=NEW.bank_refund_hash)
BEGIN SELECT RAISE(ABORT,'RECURRING_BANK_REFERENCE_ALREADY_USED'); END;
INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(
 'schema-0054-recurring-finance-ledger-execution',
 'UNDEPLOYED fixed-cost expense and SBI units/cost journal after current signed standing HomeFlow authority');
