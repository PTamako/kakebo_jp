-- 0040 DRAFT ONLY: owner-authorized SBI point-funded purchase receipts.
-- This is an INTERNAL RECORD of user-attested completed broker trades, never
-- an actual securities order. Does not alter/import old investment_holdings.
-- Source POINT debit and target acquisition LOT share one SQLite INSERT.
ALTER TABLE family_points_intents ADD COLUMN sbi_fund_code TEXT;
ALTER TABLE family_points_intents ADD COLUMN sbi_account_type TEXT;
ALTER TABLE family_points_intents ADD COLUMN sbi_confirmed_units INTEGER;
ALTER TABLE family_points_intents ADD COLUMN sbi_broker_reference_hash TEXT;
CREATE TRIGGER IF NOT EXISTS trg_points_sbi_intent_immutable
 BEFORE UPDATE OF sbi_fund_code,sbi_account_type,sbi_confirmed_units,
  sbi_broker_reference_hash ON family_points_intents
 BEGIN SELECT RAISE(ABORT,'POINTS_SBI_INTENT_IMMUTABLE'); END;

DROP TRIGGER IF EXISTS trg_points_prepaid_intent_guard;
CREATE TRIGGER IF NOT EXISTS trg_points_prepaid_intent_guard
 BEFORE INSERT ON family_points_intents
 WHEN (NEW.operation IN ('transfer_prepaid','offset_card','transfer_out','exchange_out','redeem_asset') AND (
  NEW.target_account_id IS NULL OR NEW.target_version IS NULL OR
  NOT EXISTS(SELECT 1 FROM family_financial_accounts a
   WHERE a.account_id=NEW.target_account_id AND a.household_id=NEW.household_id
   AND a.owner_user_id=NEW.requester_user_id AND a.origin='member_created'
   AND a.is_archived=0 AND a.version=NEW.target_version AND a.opening_balance=0
   AND a.account_kind=CASE WHEN NEW.operation='transfer_prepaid' THEN 'prepaid'
    WHEN NEW.operation='offset_card' THEN 'credit_card'
    WHEN NEW.operation='redeem_asset' THEN 'securities'
    ELSE 'points' END)))
 OR (NEW.operation NOT IN ('transfer_prepaid','offset_card','transfer_out','exchange_out','redeem_asset') AND
  (NEW.target_account_id IS NOT NULL OR NEW.target_version IS NOT NULL))
 OR (NEW.operation='offset_card' AND (
   NEW.target_purchase_request_id IS NULL OR NOT EXISTS(
    SELECT 1 FROM family_card_purchase_applied p
    WHERE p.homeflow_request_id=NEW.target_purchase_request_id
      AND p.account_id=NEW.target_account_id AND p.household_id=NEW.household_id
      AND p.requester_user_id=NEW.requester_user_id)))
 OR (NEW.operation IN ('transfer_out','exchange_out') AND (
  NEW.target_units IS NULL OR NEW.target_units NOT BETWEEN 1 AND 1000000000
  OR NEW.target_rate_numerator IS NULL OR NEW.target_rate_numerator NOT BETWEEN 1 AND 1000000000
  OR NEW.target_rate_denominator IS NULL OR NEW.target_rate_denominator NOT BETWEEN 1 AND 1000000000))
 OR (NEW.operation NOT IN ('transfer_out','exchange_out') AND (
  NEW.target_units IS NOT NULL OR NEW.target_rate_numerator IS NOT NULL
  OR NEW.target_rate_denominator IS NOT NULL))
 OR (NEW.operation<>'offset_card' AND NEW.target_purchase_request_id IS NOT NULL)
 BEGIN SELECT RAISE(ABORT,'POINTS_TARGET_ACCOUNT_INVALID'); END;

CREATE TRIGGER IF NOT EXISTS trg_points_sbi_intent_guard
 BEFORE INSERT ON family_points_intents
 WHEN (NEW.operation='redeem_asset' AND (
  NEW.target_account_id IS NULL OR NEW.target_version IS NULL
  OR NEW.sbi_fund_code IS NULL OR length(NEW.sbi_fund_code)<>8
  OR NEW.sbi_fund_code GLOB '*[^A-Z0-9]*'
  OR NEW.sbi_account_type NOT IN ('growth','tsumitate')
  OR NEW.sbi_confirmed_units IS NULL
  OR NEW.sbi_confirmed_units NOT BETWEEN 1 AND 1000000000000
  OR NEW.sbi_broker_reference_hash IS NULL
  OR length(NEW.sbi_broker_reference_hash)<>64
  OR NEW.sbi_broker_reference_hash GLOB '*[^a-f0-9]*'))
 OR (NEW.operation<>'redeem_asset' AND (
  NEW.sbi_fund_code IS NOT NULL OR NEW.sbi_account_type IS NOT NULL
  OR NEW.sbi_confirmed_units IS NOT NULL
  OR NEW.sbi_broker_reference_hash IS NOT NULL))
 BEGIN SELECT RAISE(ABORT,'POINTS_SBI_PURCHASE_FIELDS_INVALID'); END;

CREATE TABLE IF NOT EXISTS family_sbi_point_lots (
 homeflow_request_id TEXT PRIMARY KEY REFERENCES family_points_journal(homeflow_request_id) ON DELETE RESTRICT,
 household_id TEXT NOT NULL,
 owner_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 points_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 securities_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 securities_version INTEGER NOT NULL CHECK(securities_version>=1),
 fund_code TEXT NOT NULL CHECK(length(fund_code)=8 AND fund_code NOT GLOB '*[^A-Z0-9]*'),
 account_type TEXT NOT NULL CHECK(account_type IN ('growth','tsumitate')),
 confirmed_units INTEGER NOT NULL CHECK(confirmed_units BETWEEN 1 AND 1000000000000),
 acquisition_cost_jpy INTEGER NOT NULL CHECK(acquisition_cost_jpy BETWEEN 1 AND 10000000),
 total_units_after INTEGER NOT NULL CHECK(total_units_after BETWEEN 1 AND 1000000000000000),
 total_cost_after_jpy INTEGER NOT NULL CHECK(total_cost_after_jpy BETWEEN 1 AND 1000000000000000),
 broker_reference_hash TEXT NOT NULL CHECK(length(broker_reference_hash)=64) UNIQUE,
 trade_date TEXT NOT NULL CHECK(length(trade_date)=10),
 actor_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 recorded_at INTEGER NOT NULL CHECK(recorded_at>0),
 evidence_kind TEXT NOT NULL DEFAULT 'user_attested_broker_execution'
  CHECK(evidence_kind='user_attested_broker_execution'),
 CHECK(points_account_id<>securities_account_id)
);
CREATE INDEX IF NOT EXISTS idx_family_sbi_point_lots_position
 ON family_sbi_point_lots(household_id,securities_account_id,fund_code,account_type,recorded_at);
CREATE TRIGGER IF NOT EXISTS trg_sbi_point_lot_before_insert
 BEFORE INSERT ON family_sbi_point_lots
 WHEN NOT EXISTS (
  SELECT 1 FROM family_points_journal j
  JOIN family_points_intents i ON i.request_id=j.proposal_id
  JOIN family_financial_accounts securities ON securities.account_id=NEW.securities_account_id
  WHERE j.homeflow_request_id=NEW.homeflow_request_id
   AND j.operation='redeem_asset' AND j.delta_units<0
   AND j.points_account_id=NEW.points_account_id
   AND j.target_account_id=NEW.securities_account_id
   AND j.yen_value=NEW.acquisition_cost_jpy
   AND j.household_id=NEW.household_id
   AND j.requester_user_id=NEW.owner_user_id
   AND j.actor_user_id=NEW.actor_user_id
   AND j.applied_at=NEW.recorded_at AND j.effective_date=NEW.trade_date
   AND i.target_account_id=NEW.securities_account_id
   AND i.target_version=NEW.securities_version
   AND i.sbi_fund_code=NEW.fund_code
   AND i.sbi_account_type=NEW.account_type
   AND i.sbi_confirmed_units=NEW.confirmed_units
   AND i.sbi_broker_reference_hash=NEW.broker_reference_hash
   AND securities.account_kind='securities' AND securities.origin='member_created'
   AND securities.opening_balance=0 AND securities.is_archived=0
   AND securities.version=NEW.securities_version
   AND securities.household_id=NEW.household_id
   AND securities.owner_user_id=NEW.owner_user_id
   AND NEW.total_units_after=
    COALESCE((SELECT SUM(l.confirmed_units) FROM family_sbi_point_lots l
      WHERE l.securities_account_id=NEW.securities_account_id
       AND l.fund_code=NEW.fund_code AND l.account_type=NEW.account_type),0)
    +NEW.confirmed_units
   AND NEW.total_cost_after_jpy=
    COALESCE((SELECT SUM(l.acquisition_cost_jpy) FROM family_sbi_point_lots l
      WHERE l.securities_account_id=NEW.securities_account_id
       AND l.fund_code=NEW.fund_code AND l.account_type=NEW.account_type),0)
    +NEW.acquisition_cost_jpy
 )
 BEGIN SELECT RAISE(ABORT,'POINTS_SBI_LOT_COUNTERPART_INVARIANT'); END;
CREATE TRIGGER IF NOT EXISTS trg_sbi_point_lot_no_update
 BEFORE UPDATE ON family_sbi_point_lots
 BEGIN SELECT RAISE(ABORT,'POINTS_SBI_LOT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_sbi_point_lot_no_delete
 BEFORE DELETE ON family_sbi_point_lots
 BEGIN SELECT RAISE(ABORT,'POINTS_SBI_LOT_IMMUTABLE'); END;

CREATE TRIGGER IF NOT EXISTS trg_points_sbi_atomic_post
 AFTER INSERT ON family_points_journal
 WHEN NEW.operation='redeem_asset'
 BEGIN
  SELECT RAISE(ABORT,'POINTS_SBI_SOURCE_OR_TARGET_INVALID')
  WHERE NEW.delta_units>=0 OR NEW.yen_value IS NULL
    OR NEW.yen_value NOT BETWEEN 1 AND 10000000
    OR NEW.target_account_id IS NULL
    OR NOT EXISTS (
     SELECT 1 FROM family_points_intents i
     JOIN family_financial_accounts securities ON securities.account_id=i.target_account_id
     WHERE i.request_id=NEW.proposal_id
      AND i.target_account_id=NEW.target_account_id
      AND i.target_version=securities.version
      AND securities.account_kind='securities'
      AND securities.origin='member_created' AND securities.opening_balance=0
      AND securities.is_archived=0
      AND securities.household_id=NEW.household_id
      AND securities.owner_user_id=NEW.requester_user_id);
  INSERT INTO family_sbi_point_lots(
   homeflow_request_id,household_id,owner_user_id,points_account_id,
   securities_account_id,securities_version,fund_code,account_type,
   confirmed_units,acquisition_cost_jpy,total_units_after,total_cost_after_jpy,
   broker_reference_hash,trade_date,actor_user_id,recorded_at)
   SELECT NEW.homeflow_request_id,NEW.household_id,NEW.requester_user_id,
    NEW.points_account_id,NEW.target_account_id,i.target_version,
    i.sbi_fund_code,i.sbi_account_type,i.sbi_confirmed_units,NEW.yen_value,
    COALESCE((SELECT SUM(l.confirmed_units) FROM family_sbi_point_lots l
     WHERE l.securities_account_id=NEW.target_account_id
      AND l.fund_code=i.sbi_fund_code AND l.account_type=i.sbi_account_type),0)
      +i.sbi_confirmed_units,
    COALESCE((SELECT SUM(l.acquisition_cost_jpy) FROM family_sbi_point_lots l
     WHERE l.securities_account_id=NEW.target_account_id
      AND l.fund_code=i.sbi_fund_code AND l.account_type=i.sbi_account_type),0)
      +NEW.yen_value,
    i.sbi_broker_reference_hash,NEW.effective_date,NEW.actor_user_id,NEW.applied_at
   FROM family_points_intents i WHERE i.request_id=NEW.proposal_id;
 END;

INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(
 'schema-0040-points-sbi-lots',
 'UNDEPLOYED source points debit and same-D1 immutable SBI point-funded confirmed lot, no external broker order');
