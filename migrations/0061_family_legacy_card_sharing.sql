-- Owner-authorized sharing of existing payment cards. No account ownership transfer.
-- Run BEFORE enabling the corresponding API/UI. New records default to private.
CREATE TABLE IF NOT EXISTS family_legacy_card_shares (
  card_name TEXT NOT NULL REFERENCES payment_sources(name)
    ON UPDATE CASCADE ON DELETE CASCADE,
  household_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id)
    ON DELETE RESTRICT,
  grantee_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id)
    ON DELETE RESTRICT,
  is_active INTEGER NOT NULL DEFAULT 0 CHECK(is_active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>=1),
  updated_at INTEGER NOT NULL CHECK(updated_at>0),
  PRIMARY KEY(card_name,grantee_user_id),
  CHECK(owner_user_id<>grantee_user_id)
);
CREATE INDEX IF NOT EXISTS idx_legacy_card_shares_grantee
  ON family_legacy_card_shares(household_id,grantee_user_id,is_active,card_name);
CREATE TRIGGER IF NOT EXISTS trg_legacy_card_share_insert_guard
BEFORE INSERT ON family_legacy_card_shares
WHEN NOT EXISTS (
  SELECT 1 FROM payment_sources p
  JOIN homeflow_identity_links o ON o.user_id=NEW.owner_user_id
  JOIN homeflow_identity_links m ON m.user_id=NEW.grantee_user_id
  WHERE p.name=NEW.card_name AND p.is_archived=0 AND p.stat_group='card'
    AND p.source_type IN ('standard','prepaid')
    AND p.name NOT IN ('現金','その他','其他','ポイント還元')
    AND o.household_id=NEW.household_id AND o.role='owner' AND o.state='active'
    AND m.household_id=NEW.household_id AND m.role='member' AND m.state='active'
) BEGIN SELECT RAISE(ABORT,'INVALID_SHARED_CARD_AUTHORITY'); END;
-- The same household/users cannot be silently replaced; card_name may cascade
-- only when the old payment source is atomically renamed by the owner.
CREATE TRIGGER IF NOT EXISTS trg_legacy_card_share_update_guard
BEFORE UPDATE ON family_legacy_card_shares
WHEN NEW.household_id<>OLD.household_id
  OR NEW.owner_user_id<>OLD.owner_user_id
  OR NEW.grantee_user_id<>OLD.grantee_user_id
  OR NOT EXISTS(
    SELECT 1 FROM payment_sources p WHERE p.name=NEW.card_name
      AND p.stat_group='card' AND p.source_type IN ('standard','prepaid')
      AND p.name NOT IN ('現金','その他','其他','ポイント還元')
  )
BEGIN SELECT RAISE(ABORT,'IMMUTABLE_SHARED_CARD_AUTHORITY'); END;

CREATE TABLE IF NOT EXISTS family_legacy_card_share_audit (
  event_id TEXT PRIMARY KEY CHECK(length(event_id)=32),
  household_id TEXT NOT NULL,
  card_name TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  grantee_user_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('grant','revoke')),
  version INTEGER NOT NULL CHECK(version>=1),
  created_at INTEGER NOT NULL CHECK(created_at>0)
);
CREATE TRIGGER IF NOT EXISTS trg_legacy_card_share_audit_no_update
BEFORE UPDATE ON family_legacy_card_share_audit
BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_CARD_SHARE_AUDIT'); END;
CREATE TRIGGER IF NOT EXISTS trg_legacy_card_share_audit_no_delete
BEFORE DELETE ON family_legacy_card_share_audit
BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_CARD_SHARE_AUDIT'); END;

-- Browser requests cannot claim a spender in entries. An ephemeral context
-- is inserted and deleted inside the SAME D1 batch; triggers verify its grant.
CREATE TABLE IF NOT EXISTS family_legacy_card_write_context (
  client_request_id TEXT PRIMARY KEY,
  card_name TEXT NOT NULL,
  household_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
  created_at INTEGER NOT NULL CHECK(created_at>0)
);
CREATE TABLE IF NOT EXISTS family_legacy_card_spends (
  spend_id TEXT PRIMARY KEY CHECK(length(spend_id)=32),
  household_id TEXT NOT NULL,
  card_name TEXT NOT NULL REFERENCES payment_sources(name)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  owner_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id),
  actor_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id),
  entry_id INTEGER NOT NULL UNIQUE REFERENCES entries(id) ON DELETE RESTRICT,
  payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
  amount_jpy INTEGER NOT NULL CHECK(amount_jpy BETWEEN 1 AND 10000000),
  spend_date TEXT NOT NULL CHECK(length(spend_date)=10),
  created_at INTEGER NOT NULL CHECK(created_at>0),
  CHECK(owner_user_id<>actor_user_id)
);
CREATE INDEX IF NOT EXISTS idx_legacy_card_spend_owner
  ON family_legacy_card_spends(household_id,owner_user_id,card_name,spend_date);

CREATE TRIGGER IF NOT EXISTS trg_legacy_card_entry_guard
BEFORE INSERT ON entries
WHEN NEW.client_request_id LIKE 'hflegacycard:%'
  AND NOT EXISTS (
    SELECT 1 FROM family_legacy_card_write_context c
    JOIN family_legacy_card_shares s ON s.card_name=c.card_name
      AND s.household_id=c.household_id AND s.grantee_user_id=c.actor_user_id
    JOIN payment_sources p ON p.name=c.card_name
    JOIN homeflow_identity_links o ON o.user_id=s.owner_user_id
    JOIN homeflow_identity_links m ON m.user_id=c.actor_user_id
    WHERE c.client_request_id=NEW.client_request_id
      AND s.is_active=1 AND p.is_archived=0 AND p.stat_group='card'
      AND p.source_type IN ('standard','prepaid')
      AND o.household_id=c.household_id AND o.role='owner' AND o.state='active'
      AND m.household_id=c.household_id AND m.role='member' AND m.state='active'
      AND NEW.type='expense' AND NEW.payment_source=c.card_name
      AND NEW.amount BETWEEN 1 AND 10000000
  )
BEGIN SELECT RAISE(ABORT,'ACTIVE_SHARED_CARD_GRANT_REQUIRED'); END;
CREATE TRIGGER IF NOT EXISTS trg_legacy_card_entry_provenance
AFTER INSERT ON entries
WHEN NEW.client_request_id LIKE 'hflegacycard:%'
BEGIN
  INSERT INTO family_legacy_card_spends(
    spend_id,household_id,card_name,owner_user_id,actor_user_id,entry_id,
    payload_sha256,amount_jpy,spend_date,created_at
  )
  SELECT substr(NEW.client_request_id,14),c.household_id,c.card_name,s.owner_user_id,
    c.actor_user_id,NEW.id,c.payload_sha256,NEW.amount,NEW.date,c.created_at
  FROM family_legacy_card_write_context c
  JOIN family_legacy_card_shares s ON s.card_name=c.card_name
    AND s.household_id=c.household_id AND s.grantee_user_id=c.actor_user_id
  WHERE c.client_request_id=NEW.client_request_id AND s.is_active=1;
  SELECT CASE WHEN changes()!=1 THEN RAISE(ABORT,'SHARED_CARD_PROVENANCE_MISSING') END;
END;
-- An owner can still rename the payment source (the original card editor
-- atomically renames all payment-source references), but not rewrite the
-- amount, date or merchant of an immutable delegated purchase.
CREATE TRIGGER IF NOT EXISTS trg_legacy_card_entry_no_mutation
BEFORE UPDATE OF date,time,amount,category,merchant,note,raw,type,
  transfer_target,transfer_applied,transfer_date,client_request_id
ON entries
WHEN EXISTS(SELECT 1 FROM family_legacy_card_spends s WHERE s.entry_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'SHARED_CARD_SPEND_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_legacy_card_entry_no_delete
BEFORE DELETE ON entries
WHEN EXISTS(SELECT 1 FROM family_legacy_card_spends s WHERE s.entry_id=OLD.id)
BEGIN SELECT RAISE(ABORT,'SHARED_CARD_SPEND_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_legacy_card_spend_no_update
BEFORE UPDATE ON family_legacy_card_spends
BEGIN SELECT RAISE(ABORT,'SHARED_CARD_PROVENANCE_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_legacy_card_spend_no_delete
BEFORE DELETE ON family_legacy_card_spends
BEGIN SELECT RAISE(ABORT,'SHARED_CARD_PROVENANCE_IMMUTABLE'); END;

INSERT OR IGNORE INTO schema_migrations(version,description)
VALUES('schema-0061-family-legacy-card-sharing',
 'Explicit owner-to-member card spending grants, ledger-atomic attribution and immutable audit');