-- 0017: Statistics grouping for registered payment sources.
-- Manual Preview -> Production deployment only. No ledger entries, balances,
-- or source names are modified. Recover using a D1 bookmark if necessary.
ALTER TABLE payment_sources ADD COLUMN stat_group TEXT NOT NULL DEFAULT 'card'
  CHECK(stat_group IN ('card','points'));
-- Existing points wallet was explicitly registered by the user.
UPDATE payment_sources SET stat_group='points'
  WHERE name='ポイント還元' AND source_type='prepaid';
INSERT OR IGNORE INTO schema_migrations(version,description)
  VALUES('schema-0017-verified','Payment-method statistics: cards, cash and points');
