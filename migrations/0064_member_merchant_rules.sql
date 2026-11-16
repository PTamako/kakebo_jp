-- Authenticated member-owned merchant categorization and payment rules.
-- Strictly personal; no legacy rules, other member's financial data or shared ledger writes.
CREATE TABLE IF NOT EXISTS family_member_merchant_rules (
  household_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
  keyword TEXT NOT NULL CHECK(length(keyword) BETWEEN 1 AND 120),
  category TEXT NOT NULL DEFAULT '' CHECK(length(category) <= 100),
  payment_source TEXT NOT NULL DEFAULT '' CHECK(length(payment_source) <= 160),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version >= 1),
  updated_at INTEGER NOT NULL CHECK(updated_at > 0),
  PRIMARY KEY (household_id, owner_user_id, keyword),
  CHECK(category <> '' OR payment_source <> '')
);
CREATE INDEX IF NOT EXISTS idx_family_member_merchant_rules_owner
 ON family_member_merchant_rules(household_id,owner_user_id,updated_at);
INSERT OR IGNORE INTO schema_migrations(version,description)
 VALUES('schema-0064-member-merchant-rules',
 'Per-user merchant categorization and payment presets isolated by verified HomeFlow identity');