-- Stage C / unexecuted / additive. Personal ownership of existing
-- recurring (fixed fee) plans, SBI plans/history/holdings and saved card bills.
-- Does not mutate any old business table, payment source, amount or owner ID.
-- Run only AFTER encrypted full backups and isolated restore verification.
CREATE TABLE IF NOT EXISTS family_financial_resource_owners (
  resource_kind TEXT NOT NULL CHECK(resource_kind IN
    ('recurring_plan','investment_plan','investment_plan_history',
     'investment_holding','card_bill')),
  legacy_key TEXT NOT NULL CHECK(length(legacy_key) BETWEEN 1 AND 240),
  household_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id)
    ON DELETE RESTRICT,
  origin TEXT NOT NULL DEFAULT 'legacy' CHECK(origin='legacy'),
  assigned_by_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id)
    ON DELETE RESTRICT,
  assigned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(resource_kind,legacy_key)
);
CREATE INDEX IF NOT EXISTS idx_family_resource_owner_household
 ON family_financial_resource_owners(household_id,owner_user_id,resource_kind);
CREATE TRIGGER IF NOT EXISTS trg_family_resource_owner_verified_legacy
BEFORE INSERT ON family_financial_resource_owners
WHEN NEW.origin!='legacy' OR NOT EXISTS(
 SELECT 1 FROM homeflow_identity_links l WHERE l.user_id=NEW.owner_user_id
 AND l.household_id=NEW.household_id AND l.role='owner' AND l.state='active'
) OR NEW.assigned_by_user_id!=NEW.owner_user_id
BEGIN SELECT RAISE(ABORT,'LEGACY_RESOURCE_OWNER_PROOF_REQUIRED'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_resource_owner_immutable_update
BEFORE UPDATE ON family_financial_resource_owners
BEGIN SELECT RAISE(ABORT,'RESOURCE_OWNER_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_resource_owner_immutable_delete
BEFORE DELETE ON family_financial_resource_owners
BEGIN SELECT RAISE(ABORT,'RESOURCE_OWNER_IMMUTABLE'); END;
INSERT OR IGNORE INTO schema_migrations(version,description)
VALUES('schema-0025-financial-resource-ownership',
 'Unexecuted additive verified legacy fixed fee, SBI and credit bill ownership');
