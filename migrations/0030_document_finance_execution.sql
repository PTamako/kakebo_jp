-- 0030 UNEXECUTED: independent immutable document finance journal.
-- This does NOT reuse member-cash proposal FK or alter existing entries.
-- A remote approval is applied only after entries, this journal and actor
-- audit are committed atomically by the target D1.
CREATE TABLE IF NOT EXISTS document_finance_applied_actions (
 homeflow_request_id TEXT PRIMARY KEY NOT NULL CHECK(length(homeflow_request_id)=36),
 candidate_id TEXT NOT NULL UNIQUE CHECK(length(candidate_id)=32),
 household_id TEXT NOT NULL,
 requester_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 approver_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 account_version INTEGER NOT NULL CHECK(account_version>=1),
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 operation_sha256 TEXT NOT NULL CHECK(length(operation_sha256)=64),
 client_request_id TEXT NOT NULL UNIQUE,
 entry_id INTEGER NOT NULL UNIQUE REFERENCES entries(id) ON DELETE RESTRICT,
 applied_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_document_finance_applied_household
 ON document_finance_applied_actions(household_id,requester_user_id,applied_at DESC);
CREATE TRIGGER IF NOT EXISTS trg_document_finance_applied_immutable_update
 BEFORE UPDATE ON document_finance_applied_actions
 BEGIN SELECT RAISE(ABORT,'DOCUMENT_FINANCE_RECEIPT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_document_finance_applied_immutable_delete
 BEFORE DELETE ON document_finance_applied_actions
 BEGIN SELECT RAISE(ABORT,'DOCUMENT_FINANCE_RECEIPT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_document_finance_applied_exact_entry
 BEFORE INSERT ON document_finance_applied_actions
 WHEN NOT EXISTS (
 SELECT 1 FROM entries e
 JOIN family_financial_accounts a ON a.account_id=NEW.account_id
 JOIN homeflow_identity_links member ON member.user_id=NEW.requester_user_id
 JOIN homeflow_identity_links approver ON approver.user_id=NEW.approver_user_id
 WHERE e.id=NEW.entry_id AND e.client_request_id=NEW.client_request_id
 AND e.family_account_id=NEW.account_id
 AND a.account_id=NEW.account_id AND a.version=NEW.account_version
 AND a.owner_user_id=NEW.requester_user_id AND a.household_id=NEW.household_id
 AND a.origin='member_created' AND a.account_kind='cash' AND a.is_archived=0
 AND member.household_id=NEW.household_id AND member.role='member'
 AND member.state='active' AND approver.household_id=NEW.household_id
 AND approver.role='owner' AND approver.state='active'
 AND NEW.requester_user_id<>NEW.approver_user_id
 ) BEGIN SELECT RAISE(ABORT,'DOCUMENT_FINANCE_TARGET_MISMATCH'); END;
INSERT OR IGNORE INTO schema_migrations(version,description)
 VALUES('schema-0030-document-finance-execution',
 'Document sync finance: target atomic journal and actor receipt (unexecuted)');
