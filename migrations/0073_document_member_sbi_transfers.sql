-- 0073: Member-owned document-confirmed SBI asset transfer journal.
-- No card/bank account is created and no legacy entries or SBI lots are changed.
CREATE TABLE IF NOT EXISTS family_document_personal_sbi_transfers(
 transfer_id TEXT PRIMARY KEY NOT NULL CHECK(length(transfer_id)=32),
 household_id TEXT NOT NULL,
 owner_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 source_document_id TEXT NOT NULL,
 source_candidate_id TEXT NOT NULL UNIQUE CHECK(length(source_candidate_id)=32),
 source_sha256 TEXT NOT NULL CHECK(length(source_sha256)=64),
 date TEXT NOT NULL,
 effective_date TEXT NOT NULL,
 amount_jpy INTEGER NOT NULL CHECK(amount_jpy BETWEEN 1 AND 10000000),
 purpose TEXT NOT NULL CHECK(purpose IN ('monthly','purchase')),
 merchant TEXT NOT NULL,
 note TEXT NOT NULL DEFAULT '',
 state TEXT NOT NULL DEFAULT 'active' CHECK(state IN ('active','trashed')),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_personal_document_sbi_owner_date
 ON family_document_personal_sbi_transfers(household_id,owner_user_id,date,transfer_id);
CREATE TABLE IF NOT EXISTS family_document_personal_sbi_audit(
 audit_id TEXT PRIMARY KEY CHECK(length(audit_id)=32),
 transfer_id TEXT NOT NULL REFERENCES family_document_personal_sbi_transfers(transfer_id) ON DELETE RESTRICT,
 actor_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 action TEXT NOT NULL CHECK(action IN ('create','update','trash','restore')),
 before_version INTEGER NOT NULL,
 after_version INTEGER NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS trg_personal_document_sbi_identity_immutable
 BEFORE UPDATE OF transfer_id,household_id,owner_user_id,source_document_id,source_candidate_id,source_sha256,created_at
 ON family_document_personal_sbi_transfers
 WHEN OLD.transfer_id<>NEW.transfer_id OR OLD.household_id<>NEW.household_id
  OR OLD.owner_user_id<>NEW.owner_user_id OR OLD.source_document_id<>NEW.source_document_id
  OR OLD.source_candidate_id<>NEW.source_candidate_id OR OLD.source_sha256<>NEW.source_sha256
  OR OLD.created_at<>NEW.created_at
 BEGIN SELECT RAISE(ABORT,'PERSONAL_DOCUMENT_SBI_IDENTITY_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_personal_document_sbi_no_delete
 BEFORE DELETE ON family_document_personal_sbi_transfers
 BEGIN SELECT RAISE(ABORT,'PERSONAL_DOCUMENT_SBI_DELETE_FORBIDDEN'); END;
CREATE TRIGGER IF NOT EXISTS trg_personal_document_sbi_audit_append_update
 BEFORE UPDATE ON family_document_personal_sbi_audit
 BEGIN SELECT RAISE(ABORT,'PERSONAL_DOCUMENT_SBI_AUDIT_APPEND_ONLY'); END;
CREATE TRIGGER IF NOT EXISTS trg_personal_document_sbi_audit_append_delete
 BEFORE DELETE ON family_document_personal_sbi_audit
 BEGIN SELECT RAISE(ABORT,'PERSONAL_DOCUMENT_SBI_AUDIT_APPEND_ONLY'); END;
INSERT OR IGNORE INTO schema_migrations(version,description)
 VALUES('schema-0073-document-member-sbi','Member-owned document SBI movement journal, no account or broker lot mutation');
