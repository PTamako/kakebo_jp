-- 0016: Make every entry category type and default authoritative in D1.
-- Apply to Preview first, then Production after taking a recovery bookmark.
-- This migration is additive: no entries, rules, accounts, balances, or history are rewritten.
ALTER TABLE category_source ADD COLUMN entry_type TEXT NOT NULL DEFAULT 'expense'
  CHECK(entry_type IN ('expense','income','transfer'));
ALTER TABLE category_source ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0
  CHECK(is_default IN (0,1));

-- Preserve all historical category IDs. Classify the existing rows once.
UPDATE category_source SET entry_type='income'
  WHERE category IN ('工资','奖金','副业','老公生活费','父母赠与','亲友赠与','退款','其他收入','ポイント還元');
UPDATE category_source SET entry_type='transfer'
  WHERE category='投資・資産移動';

-- Defaults are owned by D1, not hard-coded into the form.
UPDATE category_source SET is_default=1
  WHERE category IN ('日用品','工资','投資・資産移動');

CREATE INDEX IF NOT EXISTS idx_category_source_entry_type_sort
  ON category_source(entry_type,sort_order,category);

INSERT OR IGNORE INTO schema_migrations(version,description)
  VALUES('schema-0016-verified','D1 category types and defaults; no ledger rewrite');
