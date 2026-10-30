CREATE TABLE IF NOT EXISTS entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,            -- YYYY-MM-DD
  time TEXT NOT NULL DEFAULT '', -- HH:MM，可为空
  amount INTEGER NOT NULL,       -- 日元，整数
  category TEXT NOT NULL DEFAULT '其他',
  merchant TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  raw TEXT NOT NULL DEFAULT '',  -- 识别前的原文
  type TEXT NOT NULL DEFAULT 'expense' CHECK(type IN ('expense','income','transfer')),
  transfer_target TEXT,
  transfer_applied INTEGER NOT NULL DEFAULT 0,
  transfer_date TEXT,
  client_request_id TEXT,
  payment_source TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_entries_date ON entries(date);
-- 新建数据库可直接建立去重索引；已有数据库由 API 兼容迁移创建。
CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_client_request_id ON entries(client_request_id);

CREATE TABLE IF NOT EXISTS rules (
  keyword TEXT PRIMARY KEY,
  category TEXT NOT NULL
);

INSERT OR IGNORE INTO rules (keyword, category) VALUES
('ローソン','饮食料品'),('セブン','饮食料品'),('ファミリーマート','饮食料品'),('ファミマ','饮食料品'),
('マクドナルド','餐饮'),('スターバックス','餐饮'),('すき家','餐饮'),('吉野家','餐饮'),
('午饭','餐饮'),('晚饭','餐饮'),('早饭','餐饮'),('咖啡','餐饮'),('ランチ','餐饮'),
('JR','交通'),('Suica','交通'),('PASMO','交通'),('メトロ','交通'),('バス','交通'),('タクシー','交通'),('打车','交通'),('地铁','交通'),
('ドラッグ','日用品'),('マツモトキヨシ','日用品'),('ダイソー','日用品'),('ニトリ','日用品'),('スーパー','饮食料品'),('イオン','饮食料品'),
('Amazon','购物'),('アマゾン','购物'),('ユニクロ','购物'),('楽天','购物'),
('家賃','居住'),('房租','居住'),('電気','居住'),('ガス','居住'),('水道','居住'),('水电','居住'),
('病院','医疗'),('薬局','医疗'),('クリニック','医疗'),
('映画','娱乐'),('カラオケ','娱乐'),('Netflix','娱乐');


-- SBI投信積立などの資金移動は entries.type='transfer' とし、生活費統計から除外する。

-- Payment settings are independent from immutable historical transaction amounts.
CREATE TABLE IF NOT EXISTS payment_sources (
  name TEXT PRIMARY KEY,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0,1)),
  closing_day INTEGER DEFAULT NULL CHECK(closing_day IS NULL OR closing_day BETWEEN 0 AND 31),
  source_type TEXT NOT NULL DEFAULT 'standard' CHECK(source_type IN ('standard','prepaid')),
  opening_balance INTEGER NOT NULL DEFAULT 0 CHECK(opening_balance >= 0),
  opening_date TEXT NOT NULL DEFAULT '',
  opening_entry_id INTEGER NOT NULL DEFAULT 0 CHECK(opening_entry_id >= 0)
);
-- One active merchant preference row can have both a category and a
-- payment source. Legacy custom_rules/merchant_payment_rules are retained
-- unchanged on existing D1 installations for rollback only.
CREATE TABLE IF NOT EXISTS merchant_rules (
  keyword TEXT PRIMARY KEY,
  category TEXT,
  payment_source TEXT,
  CHECK (category IS NOT NULL OR payment_source IS NOT NULL)
);

-- Normalized recurring schedules preserve their IDs for duplicate-safe auto entries.
CREATE TABLE IF NOT EXISTS recurring_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  amount INTEGER NOT NULL CHECK(amount > 0),
  day INTEGER NOT NULL CHECK(day BETWEEN 1 AND 31),
  category TEXT NOT NULL,
  payment_source TEXT NOT NULL,
  start_month TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1))
);

-- Saved statement totals are snapshots; deleting a bill must not touch entries.
CREATE TABLE IF NOT EXISTS card_bills (
  payment_source TEXT NOT NULL,
  bill_month TEXT NOT NULL,
  period_start TEXT NOT NULL,
  period_end TEXT NOT NULL,
  total_amount INTEGER NOT NULL CHECK(total_amount >= 0),
  transaction_count INTEGER NOT NULL CHECK(transaction_count >= 0),
  PRIMARY KEY (payment_source,bill_month)
);


-- New installations can bootstrap these tables immediately; old installations
-- retain their existing tables and are upgraded additively.
CREATE TABLE IF NOT EXISTS category_source (
  category TEXT PRIMARY KEY,
  sort_order INTEGER,
  icon TEXT,
  display_name TEXT
);
-- New installs only use merchant_rules; legacy tables are not created.
CREATE TABLE IF NOT EXISTS dismissed_transfer_reminders (entry_id INTEGER PRIMARY KEY, dismissed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS ai_ocr_daily_usage (day TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0);
-- Migration history may be inspected manually; normal API reads never insert markers.
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  description TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS device_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS login_attempts (ip_hash TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at INTEGER NOT NULL);

-- One source for category ordering and icon selection. Other stays at 99999.
INSERT OR IGNORE INTO category_source(category,sort_order) VALUES
('餐饮',0),('饮食料品',1),('日用品',2),('交通',3),('购物',4),
('居住',5),('医疗',6),('娱乐',7),('宠物',8),
('其他',99999),('其他收入',99999);

-- Fresh databases include the additive SBI portfolio tables.
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
