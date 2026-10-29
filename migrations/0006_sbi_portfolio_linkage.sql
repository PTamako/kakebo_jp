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
