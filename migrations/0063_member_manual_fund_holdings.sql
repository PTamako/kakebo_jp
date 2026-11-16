-- 0063: personal manual fund holdings; NOT broker trades or family ledger.
-- A member must own these exact rows. Never reuse global investment_holdings.
CREATE TABLE IF NOT EXISTS family_member_manual_holdings (
 household_id TEXT NOT NULL,
 owner_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 fund_code TEXT NOT NULL CHECK(length(fund_code)=8 AND fund_code NOT GLOB '*[^A-Z0-9]*'),
 account_type TEXT NOT NULL CHECK(account_type IN ('growth','tsumitate','combined')),
 fund_name TEXT NOT NULL CHECK(length(fund_name) BETWEEN 1 AND 120),
 units INTEGER NOT NULL CHECK(units BETWEEN 0 AND 1000000000000),
 acquisition_cost INTEGER NOT NULL CHECK(acquisition_cost BETWEEN 0 AND 1000000000000),
 nav_per_10000 INTEGER CHECK(nav_per_10000 BETWEEN 1 AND 1000000000),
 price_date TEXT CHECK(price_date IS NULL OR price_date GLOB '20[0-9][0-9]-[01][0-9]-[0-3][0-9]'),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 created_at INTEGER NOT NULL CHECK(created_at>0),
 updated_at INTEGER NOT NULL CHECK(updated_at>=created_at),
 PRIMARY KEY(household_id,owner_user_id,fund_code,account_type),
 CHECK((nav_per_10000 IS NULL)=(price_date IS NULL)),
 CHECK((units=0)=(acquisition_cost=0))
);
CREATE INDEX IF NOT EXISTS idx_member_holdings_owner
 ON family_member_manual_holdings(household_id,owner_user_id,updated_at DESC);
CREATE TRIGGER IF NOT EXISTS trg_member_holding_owner_insert
 BEFORE INSERT ON family_member_manual_holdings
 WHEN NOT EXISTS(SELECT 1 FROM homeflow_identity_links i
  WHERE i.user_id=NEW.owner_user_id AND i.household_id=NEW.household_id
   AND i.state='active' AND i.role IN ('owner','member'))
 BEGIN SELECT RAISE(ABORT,'MANUAL_HOLDING_OWNER_INVALID'); END;
CREATE TRIGGER IF NOT EXISTS trg_member_holding_immutable_scope
 BEFORE UPDATE OF household_id,owner_user_id,fund_code,account_type,created_at
 ON family_member_manual_holdings
 BEGIN SELECT RAISE(ABORT,'MANUAL_HOLDING_SCOPE_IMMUTABLE'); END;
INSERT OR IGNORE INTO schema_migrations(version,description)
 VALUES('schema-0063-member-manual-fund-holdings',
 'Isolated manual fund holdings for HomeFlow users; no broker orders, no family ledger effects');
