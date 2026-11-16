-- 0026 additive Stage D financial execution journal (UNEXECUTED).
-- Run only after encrypted backups of 4 D1/R2 and verified isolated restore.
-- Existing family entries are untouched. New member CASH postings only are
-- bound to immutable stable account IDs, never overloaded legacy card names.
ALTER TABLE entries ADD COLUMN family_account_id TEXT REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_entries_family_account_date
 ON entries(family_account_id,date DESC,id DESC)
 WHERE family_account_id IS NOT NULL;
-- Already created by schema.sql / previous migrations in production; keep
-- the idempotency constraint even for independently migrated legacy D1.
CREATE UNIQUE INDEX IF NOT EXISTS idx_entries_client_request_id
 ON entries(client_request_id);

CREATE TABLE IF NOT EXISTS family_finance_applied_actions (
 homeflow_request_id TEXT PRIMARY KEY NOT NULL CHECK(length(homeflow_request_id)=36),
 proposal_id TEXT NOT NULL UNIQUE
   REFERENCES family_finance_pending_actions(request_id) ON DELETE RESTRICT,
 household_id TEXT NOT NULL,
 requester_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 approver_user_id TEXT NOT NULL,
 account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 client_request_id TEXT NOT NULL UNIQUE,
 entry_id INTEGER NOT NULL UNIQUE REFERENCES entries(id) ON DELETE RESTRICT,
 actor_type TEXT NOT NULL DEFAULT 'integration' CHECK(actor_type='integration'),
 applied_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_family_fin_applied_member
 ON family_finance_applied_actions(household_id,requester_user_id,applied_at DESC);
CREATE TRIGGER IF NOT EXISTS trg_family_fin_applied_immutable_update
 BEFORE UPDATE ON family_finance_applied_actions
 BEGIN SELECT RAISE(ABORT,'APPLIED_RESULT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_fin_applied_immutable_delete
 BEFORE DELETE ON family_finance_applied_actions
 BEGIN SELECT RAISE(ABORT,'APPLIED_RESULT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_fin_applied_entry_match
 BEFORE INSERT ON family_finance_applied_actions
 WHEN NOT EXISTS (
   SELECT 1 FROM entries e
   JOIN family_financial_accounts a ON a.account_id=NEW.account_id
   JOIN family_finance_pending_actions p ON p.request_id=NEW.proposal_id
   WHERE e.id=NEW.entry_id AND e.family_account_id=NEW.account_id
     AND e.client_request_id=NEW.client_request_id
     AND p.homeflow_approval_id=NEW.homeflow_request_id
     AND p.payload_sha256=NEW.payload_sha256
     AND p.household_id=NEW.household_id
     AND p.requester_user_id=NEW.requester_user_id
     AND p.account_id=NEW.account_id
     AND p.state='submitted'
     AND a.account_kind='cash' AND a.origin='member_created'
     AND a.owner_user_id=NEW.requester_user_id
     AND a.household_id=NEW.household_id
     AND a.is_archived=0
 )
 BEGIN SELECT RAISE(ABORT,'EXECUTION_TARGET_MISMATCH'); END;
INSERT OR IGNORE INTO schema_migrations(version,description)
 VALUES('schema-0026-family-finance-execution',
 'Stable account ID plus append-only once-only cash finance execution, unexecuted');
