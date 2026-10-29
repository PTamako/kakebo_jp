-- Additive SBI portfolio ledger. Apply to a CLONED D1 first; do not run
-- DDL during API requests. No existing entries or valuations are modified.
CREATE TABLE IF NOT EXISTS investment_plans (
  fund_code TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK(account_type IN ('growth','tsumitate')),
  fund_name TEXT NOT NULL,
  monthly_amount INTEGER NOT NULL CHECK(monthly_amount >= 0),
  order_day INTEGER NOT NULL CHECK(order_day BETWEEN 1 AND 28),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(fund_code, account_type)
);
-- Versioned allocations prevent future edits from rewriting historical months.
CREATE TABLE IF NOT EXISTS investment_plan_history (
  fund_code TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK(account_type IN ('growth','tsumitate')),
  effective_month TEXT NOT NULL CHECK(length(effective_month) = 7),
  fund_name TEXT NOT NULL,
  monthly_amount INTEGER NOT NULL CHECK(monthly_amount >= 0),
  order_day INTEGER NOT NULL CHECK(order_day BETWEEN 1 AND 28),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(fund_code, account_type, effective_month)
);
CREATE INDEX IF NOT EXISTS idx_plan_history_month ON investment_plan_history(effective_month);

CREATE TABLE IF NOT EXISTS investment_holdings (
  fund_code TEXT NOT NULL,
  -- SBI「銘柄でまとめる」 may combine both NISA account types in one row.
  -- Never pretend an aggregate position belongs only to tsumitate/growth.
  account_type TEXT NOT NULL CHECK(account_type IN ('growth','tsumitate','combined')),
  fund_name TEXT NOT NULL,
  units INTEGER NOT NULL CHECK(units >= 0),
  acquisition_cost INTEGER NOT NULL CHECK(acquisition_cost >= 0),
  -- Exact SBI-screen values; use only until a newer NAV / changed holding supersedes them.
  reported_value INTEGER CHECK(reported_value IS NULL OR reported_value >= 0),
  reported_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(fund_code, account_type)
);
CREATE TABLE IF NOT EXISTS fund_prices (
  fund_code TEXT PRIMARY KEY,
  nav_per_10000 INTEGER NOT NULL CHECK(nav_per_10000 > 0),
  price_date TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Optional exact purchase-month override for transfers. Unoverridden
-- transfers use a clearly labelled date-based estimate in the read API.
CREATE TABLE IF NOT EXISTS sbi_transfer_links (
  entry_id INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE CASCADE,
  purchase_month TEXT NOT NULL CHECK(length(purchase_month) = 7),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_sbi_transfer_links_month ON sbi_transfer_links(purchase_month);

-- User-confirmed one-time NISA initial state (observed 2026-10-30 00:41 JST).
-- Do not execute as a recurring job or silently overwrite newer account data.
-- Any future holding edits and new funds belong to the in-app Assets editor.
-- The 3 combined rows are SBI's「銘柄でまとめる」display, not account-level split.
INSERT OR IGNORE INTO investment_plans
 (fund_code,account_type,fund_name,monthly_amount,order_day,enabled)
VALUES
 ('0331418A','tsumitate','eMAXIS Slim 全世界株式（オール・カントリー）',7000,9,1),
 ('03311187','tsumitate','eMAXIS Slim 米国株式（S&P500）',3000,9,1),
 ('0331A172','growth','eMAXIS Slim 先進国債券インデックス（除く日本）',3000,9,1),
 ('04317188','tsumitate','iFreeNEXT NASDAQ100インデックス',2000,9,1);

INSERT OR IGNORE INTO investment_plan_history
 (fund_code,account_type,effective_month,fund_name,monthly_amount,order_day,enabled)
SELECT fund_code,account_type,'2026-10',fund_name,monthly_amount,order_day,enabled
FROM investment_plans;

INSERT INTO investment_holdings
 (fund_code,account_type,fund_name,units,acquisition_cost,reported_value,reported_at)
SELECT '03311187','combined','eMAXIS Slim 米国株式（S&P500）',4043,18000,18230,'2026-10-30T00:41:00+09:00'
WHERE NOT EXISTS(SELECT 1 FROM investment_holdings WHERE fund_code='03311187');
INSERT INTO investment_holdings
 (fund_code,account_type,fund_name,units,acquisition_cost,reported_value,reported_at)
SELECT '0331418A','combined','eMAXIS Slim 全世界株式（オール・カントリー）',8033,30559,30446,'2026-10-30T00:41:00+09:00'
WHERE NOT EXISTS(SELECT 1 FROM investment_holdings WHERE fund_code='0331418A');
INSERT INTO investment_holdings
 (fund_code,account_type,fund_name,units,acquisition_cost,reported_value,reported_at)
SELECT '0331A172','growth','eMAXIS Slim 先進国債券インデックス（除く日本）',5293,8000,7999,'2026-10-30T00:41:00+09:00'
WHERE NOT EXISTS(SELECT 1 FROM investment_holdings WHERE fund_code='0331A172');
INSERT INTO investment_holdings
 (fund_code,account_type,fund_name,units,acquisition_cost,reported_value,reported_at)
SELECT '04317188','combined','iFreeNEXT NASDAQ100インデックス',2651,14880,14885,'2026-10-30T00:41:00+09:00'
WHERE NOT EXISTS(SELECT 1 FROM investment_holdings WHERE fund_code='04317188');

-- Price observation date is 2026-10-30. It is not an independently
-- confirmed NAV calculation business date.
INSERT OR IGNORE INTO fund_prices (fund_code,nav_per_10000,price_date,source)
VALUES
 ('03311187',45093,'2026-10-30','sbi_screenshot'),
 ('0331418A',37902,'2026-10-30','sbi_screenshot'),
 ('0331A172',15114,'2026-10-30','sbi_screenshot'),
 ('04317188',56153,'2026-10-30','sbi_screenshot');
