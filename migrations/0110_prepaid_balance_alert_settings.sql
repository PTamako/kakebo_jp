-- Per-card low-balance alerts. Settings are personal and never transferred by card sharing.
-- Apply to the existing production D1 after backup/verification, before deploying code.
CREATE TABLE IF NOT EXISTS prepaid_balance_alert_settings (
  account_scope TEXT NOT NULL CHECK(account_scope IN ('legacy','member')),
  resource_key TEXT NOT NULL CHECK(length(resource_key) BETWEEN 1 AND 160),
  household_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  threshold_jpy INTEGER NOT NULL DEFAULT 1000 CHECK(threshold_jpy BETWEEN 0 AND 100000000),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  updated_at INTEGER NOT NULL CHECK(updated_at>0),
  PRIMARY KEY(account_scope,resource_key)
);
CREATE INDEX IF NOT EXISTS idx_prepaid_alert_owner
  ON prepaid_balance_alert_settings(household_id,owner_user_id,enabled);
CREATE TRIGGER IF NOT EXISTS trg_prepaid_alert_authorized_insert
BEFORE INSERT ON prepaid_balance_alert_settings
WHEN NOT EXISTS(
 SELECT 1 FROM homeflow_identity_links l
 WHERE l.user_id=NEW.owner_user_id AND l.household_id=NEW.household_id AND l.state='active'
) OR (NEW.account_scope='legacy' AND NOT EXISTS(
 SELECT 1 FROM payment_sources p JOIN family_legacy_owner_claims c
   ON c.record_scope='payment_source' AND c.record_key=p.name
 WHERE p.name=NEW.resource_key AND p.source_type='prepaid' AND p.is_archived=0
   AND c.owner_user_id=NEW.owner_user_id AND c.household_id=NEW.household_id
)) OR (NEW.account_scope='member' AND NOT EXISTS(
 SELECT 1 FROM family_financial_accounts a
 WHERE a.account_id=NEW.resource_key AND a.account_kind='prepaid'
   AND a.origin='member_created' AND a.is_archived=0
   AND a.owner_user_id=NEW.owner_user_id AND a.household_id=NEW.household_id
))
BEGIN SELECT RAISE(ABORT,'PREPAID_ALERT_OWNER_REQUIRED'); END;
CREATE TRIGGER IF NOT EXISTS trg_prepaid_alert_identity_immutable
BEFORE UPDATE OF account_scope,resource_key,household_id,owner_user_id
 ON prepaid_balance_alert_settings
WHEN NEW.account_scope<>OLD.account_scope OR NEW.resource_key<>OLD.resource_key
 OR NEW.household_id<>OLD.household_id OR NEW.owner_user_id<>OLD.owner_user_id
BEGIN SELECT RAISE(ABORT,'PREPAID_ALERT_OWNER_IMMUTABLE'); END;
-- If a legacy card is renamed, old alert settings deliberately remain inert;
-- only revalidated owner-bound settings for the new card may be enabled.
INSERT OR IGNORE INTO schema_migrations(version,description)
 VALUES('schema-0110-prepaid-balance-alert-settings',
 'Owner-bound low prepaid balance settings; no financial ledger or balance changes');
