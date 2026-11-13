-- Stage C PREPARATION. NEVER run before encrypted D1/R2 backup and
-- verified isolated restore. Additive only: no old financial data is copied,
-- reassigned or modified on migration. Identity ownership is established ONLY
-- after the original owner completes verified HomeFlow + legacy authentication.
CREATE TABLE IF NOT EXISTS family_financial_accounts (
  account_id TEXT PRIMARY KEY NOT NULL CHECK(length(account_id)=32),
  household_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
  label TEXT NOT NULL CHECK(length(trim(label)) BETWEEN 1 AND 80),
  account_kind TEXT NOT NULL CHECK(account_kind IN
    ('credit_card','prepaid','cash','bank','points','securities','other')),
  source_type TEXT NOT NULL DEFAULT 'standard' CHECK(source_type IN ('standard','prepaid')),
  stat_group TEXT NOT NULL DEFAULT 'card' CHECK(stat_group IN ('card','points')),
  closing_day INTEGER CHECK(closing_day IS NULL OR closing_day BETWEEN 0 AND 31),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0,1)),
  is_archived INTEGER NOT NULL DEFAULT 0 CHECK(is_archived IN (0,1)),
  opening_balance INTEGER NOT NULL DEFAULT 0 CHECK(opening_balance>=0),
  opening_date TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL CHECK(origin IN ('legacy','member_created')),
  legacy_source_name TEXT UNIQUE,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  created_by_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id),
  updated_by_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK((origin='legacy' AND legacy_source_name IS NOT NULL)
     OR (origin='member_created' AND legacy_source_name IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_family_fin_accounts_hh_owner
  ON family_financial_accounts(household_id,owner_user_id,is_archived,sort_order,account_id);
CREATE INDEX IF NOT EXISTS idx_family_fin_accounts_owner
  ON family_financial_accounts(owner_user_id,account_id);
CREATE TRIGGER IF NOT EXISTS trg_family_fin_account_verified_owner
BEFORE INSERT ON family_financial_accounts
WHEN NOT EXISTS(SELECT 1 FROM homeflow_identity_links l
  WHERE l.user_id=NEW.owner_user_id AND l.household_id=NEW.household_id
    AND l.state='active')
  OR NOT EXISTS(SELECT 1 FROM homeflow_identity_links a
  WHERE a.user_id=NEW.created_by_user_id AND a.household_id=NEW.household_id
    AND a.state='active')
BEGIN SELECT RAISE(ABORT,'UNVERIFIED_ACCOUNT_HOUSEHOLD'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_fin_account_immutable
BEFORE UPDATE OF account_id,household_id,owner_user_id,origin,legacy_source_name
ON family_financial_accounts
WHEN NEW.account_id!=OLD.account_id OR NEW.household_id!=OLD.household_id
  OR NEW.owner_user_id!=OLD.owner_user_id OR NEW.origin!=OLD.origin
  OR COALESCE(NEW.legacy_source_name,'')!=COALESCE(OLD.legacy_source_name,'')
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_FINANCIAL_ACCOUNT_IDENTITY'); END;
-- Keep the existing entries/payment_sources/merchant_rules/SBI/card_bills
-- unmodified. Separate stable IDs can coexist with duplicate display labels.
-- A future gated migration will add entries.finance_account_id and remap
-- legacy string references ONLY AFTER semantic mapping/counter checks.
CREATE TABLE IF NOT EXISTS family_finance_events (
  event_id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id),
  resource_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN
    ('legacy_accounts_adopted','personal_account_created','personal_account_updated',
     'personal_account_archived','finance_entry_prepared','finance_entry_cancelled')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_family_fin_events_actor
  ON family_finance_events(actor_user_id,created_at);
CREATE TRIGGER IF NOT EXISTS trg_family_fin_events_append_only_update
BEFORE UPDATE ON family_finance_events
BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_AUDIT'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_fin_events_append_only_delete
BEFORE DELETE ON family_finance_events
BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_AUDIT'); END;
INSERT OR IGNORE INTO schema_migrations(version,description)
VALUES('schema-0023-financial-account-identities',
 'Unexecuted stage C additive per-member financial account identities');
