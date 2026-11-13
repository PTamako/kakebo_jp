-- Stage B ONLY. NOT EXECUTED on production. This migration is exclusively
-- additive: it must not rewrite entries, payment_sources, holdings or devices.
-- Do not merge/deploy until four-D1/R2 encrypted restore-capable backups exist.
CREATE TABLE IF NOT EXISTS homeflow_identity_links (
  user_id TEXT PRIMARY KEY NOT NULL,
  household_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('owner','member')),
  display_name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','disabled')),
  linked_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_kakeibo_hf_one_owner_per_household
  ON homeflow_identity_links(household_id) WHERE role='owner';
CREATE INDEX IF NOT EXISTS idx_kakeibo_hf_household
  ON homeflow_identity_links(household_id,role);
CREATE TRIGGER IF NOT EXISTS trg_kakeibo_hf_identity_immutable
  BEFORE UPDATE OF user_id,household_id,role ON homeflow_identity_links
  BEGIN SELECT RAISE(ABORT,'immutable HomeFlow identity'); END;
CREATE TABLE IF NOT EXISTS homeflow_sso_pending (
  state_hash TEXT PRIMARY KEY NOT NULL,
  resume_hash TEXT NOT NULL,
  verifier_cipher TEXT NOT NULL,
  verifier_iv TEXT NOT NULL,
  code_cipher TEXT,
  code_iv TEXT,
  origin TEXT NOT NULL,
  legacy_session_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','processing','consumed','failed')),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_kakeibo_hf_pending_expiry ON homeflow_sso_pending(expires_at);
CREATE TABLE IF NOT EXISTS homeflow_sso_sessions (
  token_hash TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_kakeibo_hf_session_user ON homeflow_sso_sessions(user_id,expires_at);
CREATE TABLE IF NOT EXISTS homeflow_identity_events (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id),
  event TEXT NOT NULL CHECK(event IN ('account_linked','sso_login','sso_logout')),
  created_at INTEGER NOT NULL
);
-- No modification to the legacy ledger login or its device_sessions table.
INSERT OR IGNORE INTO schema_migrations(version,description)
 VALUES('schema-0022-homeflow-identity','Unexecuted B-stage isolated SSO account links and sessions');
