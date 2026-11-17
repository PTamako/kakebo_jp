-- Authenticated member receipt images, strictly isolated from the legacy owner R2 namespace.
-- Upload is allowed only for a verified, already-submitted personal/shared ledger request.
CREATE TABLE IF NOT EXISTS family_member_receipts (
 receipt_id TEXT PRIMARY KEY CHECK(length(receipt_id)=32),
 household_id TEXT NOT NULL,
 owner_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 receipt_ref TEXT NOT NULL CHECK(length(receipt_ref) BETWEEN 8 AND 96),
 receipt_date TEXT NOT NULL CHECK(length(receipt_date)=10),
 merchant TEXT NOT NULL DEFAULT '' CHECK(length(merchant)<=120),
 idempotency_hash TEXT NOT NULL UNIQUE CHECK(length(idempotency_hash)=64),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','ready','purge_pending','purged')),
 content_type TEXT NOT NULL CHECK(content_type IN ('image/jpeg','image/webp')),
 size_bytes INTEGER NOT NULL CHECK(size_bytes>0 AND size_bytes<=204800),
 sha256 TEXT NOT NULL CHECK(length(sha256)=64),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_family_member_receipts_personal
 ON family_member_receipts(household_id,owner_user_id,state,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_family_member_receipts_reference
 ON family_member_receipts(household_id,owner_user_id,receipt_ref);
INSERT OR IGNORE INTO schema_migrations(version,description)
 VALUES('schema-0065-member-receipts','Private member R2 receipt metadata and tombstone lifecycle');
