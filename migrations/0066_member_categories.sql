-- Member categories sync on D1 across devices; shared ledger is untouched.
CREATE TABLE IF NOT EXISTS family_member_categories (
 household_id TEXT NOT NULL,
 owner_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 entry_type TEXT NOT NULL CHECK(entry_type IN ('expense','income')),
 category TEXT NOT NULL CHECK(length(category) BETWEEN 1 AND 20),
 icon TEXT NOT NULL CHECK(length(icon) BETWEEN 1 AND 48),
 created_at INTEGER NOT NULL CHECK(created_at>0),
 PRIMARY KEY(household_id,owner_user_id,entry_type,category)
);
CREATE INDEX IF NOT EXISTS idx_member_categories_owner ON family_member_categories(household_id,owner_user_id,entry_type);
INSERT OR IGNORE INTO schema_migrations(version,description)
 VALUES('schema-0066-member-categories','Personal custom categories synced across devices by HomeFlow identity');
