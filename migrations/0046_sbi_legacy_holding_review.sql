-- 0046 UNDEPLOYED / REVIEW-ONLY: never fuse historical SBI screenshots with new point/cash lots.
-- A candidate attests only that a verified original owner reviewed two exact immutable
-- snapshots. It does NOT prove those are the same broker trade or change any asset value.
-- There is no automatic inferred matching by display name, fund ticker, date or image.
CREATE TABLE IF NOT EXISTS family_sbi_legacy_holding_candidates(
 candidate_id TEXT PRIMARY KEY CHECK(length(candidate_id)=32),
 household_id TEXT NOT NULL,
 owner_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 lot_type TEXT NOT NULL CHECK(lot_type IN ('cash','points')),
 lot_homeflow_request_id TEXT NOT NULL CHECK(length(lot_homeflow_request_id)=36),
 securities_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 lot_fund_code TEXT NOT NULL CHECK(length(lot_fund_code)=8),
 lot_account_type TEXT NOT NULL CHECK(lot_account_type IN ('growth','tsumitate')),
 lot_confirmed_units INTEGER NOT NULL CHECK(lot_confirmed_units>0),
 lot_acquisition_cost_jpy INTEGER NOT NULL CHECK(lot_acquisition_cost_jpy>0),
 lot_trade_date TEXT NOT NULL CHECK(length(lot_trade_date)=10),
 lot_broker_reference_hash TEXT NOT NULL CHECK(length(lot_broker_reference_hash)=64),
 source_lot_digest TEXT NOT NULL CHECK(length(source_lot_digest)=64),
 legacy_fund_code TEXT NOT NULL CHECK(length(legacy_fund_code)=8),
 legacy_account_type TEXT NOT NULL CHECK(legacy_account_type IN ('growth','tsumitate')),
 legacy_fund_name TEXT NOT NULL,
 legacy_units INTEGER NOT NULL CHECK(legacy_units>=0),
 legacy_acquisition_cost INTEGER NOT NULL CHECK(legacy_acquisition_cost>=0),
 legacy_reported_value INTEGER,
 legacy_reported_at TEXT,
 legacy_updated_at TEXT NOT NULL,
 legacy_snapshot_digest TEXT NOT NULL CHECK(length(legacy_snapshot_digest)=64),
 reviewer_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 reviewed_at INTEGER NOT NULL CHECK(reviewed_at>0),
 candidate_status TEXT NOT NULL DEFAULT 'pending_broker_reconciliation'
  CHECK(candidate_status='pending_broker_reconciliation'),
 included_in_tracked_assets INTEGER NOT NULL DEFAULT 0 CHECK(included_in_tracked_assets=0),
 source_trade_confirmed_as_historical_duplicate INTEGER NOT NULL DEFAULT 0
  CHECK(source_trade_confirmed_as_historical_duplicate=0),
 UNIQUE(lot_type,lot_homeflow_request_id),
 CHECK(owner_user_id=reviewer_user_id),
 CHECK(legacy_fund_code=lot_fund_code AND legacy_account_type=lot_account_type)
);
CREATE INDEX IF NOT EXISTS idx_sbi_legacy_candidate_owner
 ON family_sbi_legacy_holding_candidates(household_id,owner_user_id,reviewed_at DESC);
CREATE TRIGGER IF NOT EXISTS trg_sbi_legacy_candidate_verified_snapshot
 BEFORE INSERT ON family_sbi_legacy_holding_candidates
 WHEN NOT EXISTS(
  SELECT 1 FROM family_financial_resource_owners proof
  JOIN homeflow_identity_links owner ON owner.user_id=NEW.owner_user_id
  JOIN family_financial_accounts sec ON sec.account_id=NEW.securities_account_id
  JOIN investment_holdings h ON h.fund_code=NEW.legacy_fund_code
   AND h.account_type=NEW.legacy_account_type
  WHERE proof.resource_kind='investment_holding'
   AND proof.legacy_key=NEW.legacy_fund_code||':'||NEW.legacy_account_type
   AND proof.household_id=NEW.household_id AND proof.owner_user_id=NEW.owner_user_id
   AND proof.assigned_by_user_id=NEW.owner_user_id
   AND owner.household_id=NEW.household_id AND owner.role='owner' AND owner.state='active'
   AND sec.household_id=NEW.household_id AND sec.owner_user_id=NEW.owner_user_id
   AND sec.origin='member_created' AND sec.account_kind='securities'
   AND sec.is_archived=0 AND sec.opening_balance=0
   AND h.fund_name=NEW.legacy_fund_name
   AND h.units=NEW.legacy_units AND h.acquisition_cost=NEW.legacy_acquisition_cost
   AND h.reported_value IS NEW.legacy_reported_value
   AND h.reported_at IS NEW.legacy_reported_at
   AND h.updated_at=NEW.legacy_updated_at
 ) OR NOT(
  (NEW.lot_type='cash' AND EXISTS(
   SELECT 1 FROM family_sbi_cash_lots l
   WHERE l.homeflow_request_id=NEW.lot_homeflow_request_id
    AND l.household_id=NEW.household_id AND l.owner_user_id=NEW.owner_user_id
    AND l.securities_account_id=NEW.securities_account_id
    AND l.fund_code=NEW.lot_fund_code AND l.account_type=NEW.lot_account_type
    AND l.confirmed_units=NEW.lot_confirmed_units
    AND l.acquisition_cost_jpy=NEW.lot_acquisition_cost_jpy
    AND l.trade_date=NEW.lot_trade_date
    AND l.broker_reference_hash=NEW.lot_broker_reference_hash
    AND NOT EXISTS(SELECT 1 FROM family_sbi_cash_reversals r
     WHERE r.original_request_id=l.homeflow_request_id)
  )) OR
  (NEW.lot_type='points' AND EXISTS(
   SELECT 1 FROM family_sbi_point_lots l
   WHERE l.homeflow_request_id=NEW.lot_homeflow_request_id
    AND l.household_id=NEW.household_id AND l.owner_user_id=NEW.owner_user_id
    AND l.securities_account_id=NEW.securities_account_id
    AND l.fund_code=NEW.lot_fund_code AND l.account_type=NEW.lot_account_type
    AND l.confirmed_units=NEW.lot_confirmed_units
    AND l.acquisition_cost_jpy=NEW.lot_acquisition_cost_jpy
    AND l.trade_date=NEW.lot_trade_date
    AND l.broker_reference_hash=NEW.lot_broker_reference_hash
  ))
 )
 BEGIN SELECT RAISE(ABORT,'SBI_LEGACY_CANDIDATE_MISSING_EXACT_OWNER_OR_SNAPSHOT'); END;
CREATE TRIGGER IF NOT EXISTS trg_sbi_legacy_candidate_immutable_update
 BEFORE UPDATE ON family_sbi_legacy_holding_candidates
 BEGIN SELECT RAISE(ABORT,'SBI_LEGACY_CANDIDATE_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_sbi_legacy_candidate_immutable_delete
 BEFORE DELETE ON family_sbi_legacy_holding_candidates
 BEGIN SELECT RAISE(ABORT,'SBI_LEGACY_CANDIDATE_IMMUTABLE'); END;
CREATE TABLE IF NOT EXISTS family_sbi_legacy_candidate_audit(
 event_id TEXT PRIMARY KEY CHECK(length(event_id)=32),
 candidate_id TEXT NOT NULL UNIQUE REFERENCES family_sbi_legacy_holding_candidates(candidate_id)
  ON DELETE RESTRICT,
 household_id TEXT NOT NULL,
 reviewer_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id),
 action TEXT NOT NULL CHECK(action='reviewed_but_unreconciled'),
 created_at INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS trg_sbi_legacy_candidate_audit_guard
 BEFORE INSERT ON family_sbi_legacy_candidate_audit
 WHEN NOT EXISTS(SELECT 1 FROM family_sbi_legacy_holding_candidates c
  WHERE c.candidate_id=NEW.candidate_id AND c.household_id=NEW.household_id
  AND c.reviewer_user_id=NEW.reviewer_user_id AND c.reviewed_at=NEW.created_at)
 BEGIN SELECT RAISE(ABORT,'SBI_LEGACY_CANDIDATE_AUDIT_CONFLICT'); END;
CREATE TRIGGER IF NOT EXISTS trg_sbi_legacy_candidate_audit_immutable_update
 BEFORE UPDATE ON family_sbi_legacy_candidate_audit
 BEGIN SELECT RAISE(ABORT,'SBI_LEGACY_CANDIDATE_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_sbi_legacy_candidate_audit_immutable_delete
 BEFORE DELETE ON family_sbi_legacy_candidate_audit
 BEGIN SELECT RAISE(ABORT,'SBI_LEGACY_CANDIDATE_AUDIT_IMMUTABLE'); END;
INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(
 'schema-0046-sbi-legacy-holding-review',
 'UNDEPLOYED owner-attested exact snapshot candidate only: no broker reconciliation, asset merging or valuation');
