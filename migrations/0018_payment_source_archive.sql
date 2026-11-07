-- 0018: Additive archive flag for ordinary and prepaid payment methods.
-- Apply ONCE to Preview D1, then to Production after Preview acceptance.
-- All existing cards remain active. No entries, saved bills or balances change.
ALTER TABLE payment_sources ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0
  CHECK (is_archived IN (0,1));
INSERT OR IGNORE INTO schema_migrations(version,description)
  VALUES('schema-0018-verified','Payment-source archive flag; pre-existing sources remain active');
