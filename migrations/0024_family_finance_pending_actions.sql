-- Stage C/D: encrypted finance intent PREPARATION ONLY (UNEXECUTED).
-- No member-originated item can enter the existing entries table here.
-- Never run before durable four-D1/R2 encrypted backup + isolated restore.
CREATE TABLE IF NOT EXISTS family_finance_pending_actions (
  request_id TEXT PRIMARY KEY NOT NULL CHECK(length(request_id)=32),
  household_id TEXT NOT NULL,
  requester_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id),
  account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id),
  operation TEXT NOT NULL DEFAULT 'finance.entry.create'
    CHECK(operation='finance.entry.create'),
  idempotency_hash TEXT NOT NULL UNIQUE CHECK(length(idempotency_hash)=64),
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
  payload_cipher TEXT NOT NULL,
  payload_iv TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'prepared'
    CHECK(state IN ('prepared','submitted','cancelled')),
  homeflow_approval_id TEXT
    CHECK(homeflow_approval_id IS NULL OR
      (length(homeflow_approval_id)=36 AND
       substr(homeflow_approval_id,9,1)='-' AND
       substr(homeflow_approval_id,14,1)='-' AND
       substr(homeflow_approval_id,19,1)='-' AND
       substr(homeflow_approval_id,24,1)='-')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK(expires_at>created_at),
  submitted_at INTEGER,
  cancelled_at INTEGER,
  CHECK(
    (state='prepared' AND homeflow_approval_id IS NULL
      AND submitted_at IS NULL AND cancelled_at IS NULL)
    OR (state='submitted' AND homeflow_approval_id IS NOT NULL
      AND submitted_at IS NOT NULL AND cancelled_at IS NULL)
    OR (state='cancelled' AND homeflow_approval_id IS NULL
      AND submitted_at IS NULL AND cancelled_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_family_fin_pending_requester
 ON family_finance_pending_actions(requester_user_id,state,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_family_fin_pending_expires
 ON family_finance_pending_actions(expires_at);
CREATE TRIGGER IF NOT EXISTS trg_family_fin_pending_verified_member
BEFORE INSERT ON family_finance_pending_actions
WHEN NOT EXISTS(
 SELECT 1 FROM homeflow_identity_links u
 JOIN family_financial_accounts a ON a.owner_user_id=u.user_id
 WHERE u.user_id=NEW.requester_user_id AND u.role='member'
 AND u.household_id=NEW.household_id AND u.state='active'
 AND a.account_id=NEW.account_id AND a.household_id=NEW.household_id
 AND a.origin='member_created' AND a.is_archived=0
)
BEGIN SELECT RAISE(ABORT,'PENDING_ACCOUNT_OWNER_MISMATCH'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_fin_pending_immutable
BEFORE UPDATE OF household_id,requester_user_id,account_id,operation,
  idempotency_hash,payload_sha256,payload_cipher,payload_iv,created_at,expires_at
ON family_finance_pending_actions
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_PENDING_ACTION'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_fin_pending_state
BEFORE UPDATE OF state ON family_finance_pending_actions
WHEN NOT (OLD.state='prepared' AND NEW.state IN ('cancelled','submitted'))
BEGIN SELECT RAISE(ABORT,'INVALID_PENDING_TRANSITION'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_fin_pending_submission_immutable
BEFORE UPDATE OF homeflow_approval_id,submitted_at
ON family_finance_pending_actions
WHEN OLD.state!='prepared'
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_HOMEFLOW_APPROVAL_RECEIPT'); END;
INSERT OR IGNORE INTO schema_migrations(version,description)
VALUES('schema-0024-finance-approval-preparation',
 'Unexecuted encrypted member financial proposals without posting ledger entries');
