-- 0034 (Draft ONLY): isolated points accounting foundation.
-- No automatic import, reassignment, or backfill of legacy ポイント還元 entries.
-- This creates neither a spendable endpoint nor an active feature flag.
-- family_financial_accounts.opening_balance is a JPY field: it is NOT point units.
CREATE TABLE IF NOT EXISTS family_points_intents (
 request_id TEXT PRIMARY KEY CHECK(length(request_id)=32),
 household_id TEXT NOT NULL,
 requester_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 points_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 expected_version INTEGER NOT NULL CHECK(expected_version>=1),
 operation TEXT NOT NULL CHECK(operation IN
 ('earn_purchase','earn_campaign','redeem_discount','redeem_purchase',
  'redeem_asset','transfer_prepaid','offset_card','exchange_out',
  'transfer_out','transfer_in','expire','reversal')),
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 payload_cipher TEXT NOT NULL,
 payload_iv TEXT NOT NULL,
 idempotency_hash TEXT NOT NULL UNIQUE CHECK(length(idempotency_hash)=64),
 status TEXT NOT NULL CHECK(status IN ('prepared','submitted','cancelled')),
 homeflow_approval_id TEXT UNIQUE,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL CHECK(expires_at>created_at),
 submitted_at INTEGER,
 CHECK((status='prepared' AND homeflow_approval_id IS NULL AND submitted_at IS NULL)
    OR (status='cancelled' AND homeflow_approval_id IS NULL AND submitted_at IS NULL)
    OR (status='submitted' AND length(homeflow_approval_id)=36 AND submitted_at>0))
);
CREATE INDEX IF NOT EXISTS idx_family_points_intents_owner
 ON family_points_intents(household_id,requester_user_id,created_at DESC);
CREATE TRIGGER IF NOT EXISTS trg_family_points_intent_owner
 BEFORE INSERT ON family_points_intents
 WHEN NOT EXISTS (
  SELECT 1 FROM family_financial_accounts a JOIN homeflow_identity_links u
   ON u.user_id=NEW.requester_user_id AND u.household_id=NEW.household_id
   WHERE a.account_id=NEW.points_account_id AND a.account_kind='points'
    AND a.origin='member_created' AND a.is_archived=0 AND a.opening_balance=0
    AND a.version=NEW.expected_version AND a.household_id=NEW.household_id
    AND a.owner_user_id=NEW.requester_user_id AND u.state='active' AND u.role='member')
 BEGIN SELECT RAISE(ABORT,'POINTS_INTENT_IDENTITY_OR_VERSION'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_points_intent_identity_immutable
 BEFORE UPDATE OF request_id,household_id,requester_user_id,points_account_id,
 expected_version,operation,payload_sha256,payload_cipher,payload_iv,
 idempotency_hash,created_at,expires_at ON family_points_intents
 BEGIN SELECT RAISE(ABORT,'POINTS_INTENT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_points_intent_status
 BEFORE UPDATE OF status ON family_points_intents
 WHEN NOT(OLD.status='prepared' AND NEW.status IN ('submitted','cancelled'))
 BEGIN SELECT RAISE(ABORT,'POINTS_INTENT_STATE_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_points_intent_delete
 BEFORE DELETE ON family_points_intents
 BEGIN SELECT RAISE(ABORT,'POINTS_INTENT_IMMUTABLE'); END;

-- Units, JPY equivalent and exact exchange ratio are distinct values.
-- An event does NOT itself create another expense, bank transfer, card
-- settlement, prepaid credit or SBI purchase. Later real executors must
-- establish the counterpart in the SAME D1 batch before journal insertion.
CREATE TABLE IF NOT EXISTS family_points_journal (
 homeflow_request_id TEXT PRIMARY KEY CHECK(length(homeflow_request_id)=36),
 proposal_id TEXT NOT NULL UNIQUE REFERENCES family_points_intents(request_id) ON DELETE RESTRICT,
 household_id TEXT NOT NULL,
 requester_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 approver_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 actor_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 points_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 account_version INTEGER NOT NULL CHECK(account_version>=1),
 operation TEXT NOT NULL CHECK(operation IN
 ('earn_purchase','earn_campaign','redeem_discount','redeem_purchase',
  'redeem_asset','transfer_prepaid','offset_card','exchange_out',
  'transfer_out','transfer_in','expire','reversal')),
 delta_units INTEGER NOT NULL CHECK(delta_units BETWEEN -1000000000 AND 1000000000 AND delta_units<>0),
 balance_after_units INTEGER NOT NULL CHECK(balance_after_units BETWEEN 0 AND 1000000000000),
 yen_value INTEGER CHECK(yen_value IS NULL OR yen_value BETWEEN 0 AND 1000000000),
 yen_per_unit_numerator INTEGER CHECK(yen_per_unit_numerator IS NULL OR yen_per_unit_numerator BETWEEN 1 AND 1000000000),
 yen_per_unit_denominator INTEGER CHECK(yen_per_unit_denominator IS NULL OR yen_per_unit_denominator BETWEEN 1 AND 1000000000),
 target_account_id TEXT REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 linked_entry_id INTEGER REFERENCES entries(id) ON DELETE RESTRICT,
 legacy_entry_id INTEGER UNIQUE REFERENCES entries(id) ON DELETE RESTRICT,
 source_reference_hash TEXT CHECK(source_reference_hash IS NULL OR length(source_reference_hash)=64),
 reversed_request_id TEXT UNIQUE REFERENCES family_points_journal(homeflow_request_id) ON DELETE RESTRICT,
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 effective_date TEXT NOT NULL CHECK(length(effective_date)=10),
 applied_at INTEGER NOT NULL CHECK(applied_at>0),
 CHECK((yen_value IS NULL AND yen_per_unit_numerator IS NULL AND yen_per_unit_denominator IS NULL)
   OR (yen_value IS NOT NULL AND yen_per_unit_numerator IS NOT NULL AND yen_per_unit_denominator IS NOT NULL
   AND yen_value*yen_per_unit_denominator=ABS(delta_units)*yen_per_unit_numerator)),
 CHECK((operation='reversal' AND reversed_request_id IS NOT NULL)
    OR (operation<>'reversal' AND reversed_request_id IS NULL)),
 CHECK(target_account_id IS NULL OR target_account_id<>points_account_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_family_points_reference_once
 ON family_points_journal(points_account_id,source_reference_hash)
 WHERE source_reference_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_family_points_owner_history
 ON family_points_journal(household_id,points_account_id,applied_at DESC);
CREATE TRIGGER IF NOT EXISTS trg_family_points_journal_guard
 BEFORE INSERT ON family_points_journal
 WHEN NOT EXISTS (
   SELECT 1 FROM family_points_intents p
   JOIN family_financial_accounts a ON a.account_id=p.points_account_id
   JOIN homeflow_identity_links requester ON requester.user_id=p.requester_user_id
   JOIN homeflow_identity_links approver ON approver.user_id=NEW.approver_user_id
   WHERE p.request_id=NEW.proposal_id AND p.homeflow_approval_id=NEW.homeflow_request_id
    AND p.status='submitted' AND p.household_id=NEW.household_id
    AND p.requester_user_id=NEW.requester_user_id AND p.points_account_id=NEW.points_account_id
    AND p.expected_version=NEW.account_version AND p.operation=NEW.operation
    AND p.payload_sha256=NEW.payload_sha256 AND p.expires_at>NEW.applied_at
    AND a.account_kind='points' AND a.origin='member_created' AND a.opening_balance=0
    AND a.is_archived=0 AND a.version=NEW.account_version
    AND a.owner_user_id=NEW.requester_user_id AND a.household_id=NEW.household_id
    AND requester.state='active' AND requester.role='member'
    AND requester.household_id=NEW.household_id
    AND approver.state='active' AND approver.role='owner'
    AND approver.household_id=NEW.household_id
    AND NEW.actor_user_id=NEW.approver_user_id AND NEW.approver_user_id<>NEW.requester_user_id
 )
 OR NEW.balance_after_units<>COALESCE(
     (SELECT SUM(delta_units) FROM family_points_journal
      WHERE points_account_id=NEW.points_account_id),0)+NEW.delta_units
 OR (NEW.operation IN ('earn_purchase','earn_campaign','transfer_in') AND NEW.delta_units<=0)
 OR (NEW.operation IN ('redeem_discount','redeem_purchase','redeem_asset',
     'transfer_prepaid','offset_card','exchange_out','transfer_out','expire')
     AND NEW.delta_units>=0)
 OR (NEW.operation IN ('earn_purchase','earn_campaign') AND
     NEW.linked_entry_id IS NULL AND NEW.source_reference_hash IS NULL)
 OR (NEW.operation IN ('redeem_discount','redeem_purchase') AND NEW.linked_entry_id IS NULL)
 OR (NEW.operation IN ('transfer_prepaid','offset_card','redeem_asset','exchange_out',
     'transfer_out','transfer_in') AND NEW.target_account_id IS NULL)
 OR (NEW.target_account_id IS NOT NULL AND NOT EXISTS (
     SELECT 1 FROM family_financial_accounts a
     WHERE a.account_id=NEW.target_account_id AND a.household_id=NEW.household_id
       AND a.is_archived=0 AND a.origin='member_created'
       AND a.account_kind=CASE
         WHEN NEW.operation='transfer_prepaid' THEN 'prepaid'
         WHEN NEW.operation='offset_card' THEN 'credit_card'
         WHEN NEW.operation='redeem_asset' THEN 'securities'
         ELSE 'points' END))
 OR (NEW.operation='reversal' AND NOT EXISTS (
     SELECT 1 FROM family_points_journal old
     WHERE old.homeflow_request_id=NEW.reversed_request_id
       AND old.points_account_id=NEW.points_account_id
       AND old.operation<>'reversal' AND NEW.delta_units=-old.delta_units
       AND NEW.yen_value IS old.yen_value
       AND NEW.target_account_id IS old.target_account_id
       AND NEW.linked_entry_id IS old.linked_entry_id))
 BEGIN SELECT RAISE(ABORT,'POINTS_JOURNAL_INVARIANT'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_points_journal_no_update
 BEFORE UPDATE ON family_points_journal
 BEGIN SELECT RAISE(ABORT,'POINTS_JOURNAL_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_points_journal_no_delete
 BEFORE DELETE ON family_points_journal
 BEGIN SELECT RAISE(ABORT,'POINTS_JOURNAL_IMMUTABLE'); END;

CREATE TABLE IF NOT EXISTS family_points_actor_audit (
 event_id TEXT PRIMARY KEY CHECK(length(event_id)=32),
 homeflow_request_id TEXT NOT NULL UNIQUE REFERENCES family_points_journal(homeflow_request_id) ON DELETE RESTRICT,
 requester_user_id TEXT NOT NULL,
 approver_user_id TEXT NOT NULL,
 actor_user_id TEXT NOT NULL,
 operation TEXT NOT NULL,
 created_at INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS trg_family_points_atomic_audit
 AFTER INSERT ON family_points_journal
 BEGIN
  INSERT INTO family_points_actor_audit
   (event_id,homeflow_request_id,requester_user_id,approver_user_id,actor_user_id,operation,created_at)
  VALUES(lower(hex(randomblob(16))),NEW.homeflow_request_id,NEW.requester_user_id,
   NEW.approver_user_id,NEW.actor_user_id,NEW.operation,NEW.applied_at);
 END;
CREATE TRIGGER IF NOT EXISTS trg_family_points_audit_no_update
 BEFORE UPDATE ON family_points_actor_audit
 BEGIN SELECT RAISE(ABORT,'POINTS_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_points_audit_no_delete
 BEFORE DELETE ON family_points_actor_audit
 BEGIN SELECT RAISE(ABORT,'POINTS_AUDIT_IMMUTABLE'); END;

-- Read-only reconciliation anchor. A historical income/payment entry may be
-- linked once after verified owner migration, but no new points are minted.
CREATE TABLE IF NOT EXISTS family_points_legacy_links (
 legacy_entry_id INTEGER PRIMARY KEY REFERENCES entries(id) ON DELETE RESTRICT,
 household_id TEXT NOT NULL,
 owner_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 points_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 legacy_kind TEXT NOT NULL CHECK(legacy_kind IN ('earn','spend','topup','card_offset','sbi_point','other')),
 reviewed_by_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 reviewed_at INTEGER NOT NULL,
 CHECK(reviewed_at>0)
);
CREATE INDEX IF NOT EXISTS idx_family_points_legacy_owner
 ON family_points_legacy_links(household_id,owner_user_id,points_account_id);
CREATE TRIGGER IF NOT EXISTS trg_family_points_legacy_owner
 BEFORE INSERT ON family_points_legacy_links
 WHEN NOT EXISTS (
  SELECT 1 FROM family_financial_accounts a
  JOIN homeflow_identity_links u ON u.user_id=NEW.owner_user_id
  JOIN homeflow_identity_links reviewer ON reviewer.user_id=NEW.reviewed_by_user_id
  WHERE a.account_id=NEW.points_account_id AND a.account_kind='points'
   AND a.owner_user_id=NEW.owner_user_id AND a.household_id=NEW.household_id
   AND u.household_id=NEW.household_id AND u.state='active'
   AND reviewer.household_id=NEW.household_id AND reviewer.role='owner'
   AND reviewer.state='active')
 BEGIN SELECT RAISE(ABORT,'POINTS_LEGACY_OWNER_UNVERIFIED'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_points_legacy_no_update
 BEFORE UPDATE ON family_points_legacy_links
 BEGIN SELECT RAISE(ABORT,'POINTS_LEGACY_LINK_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_points_legacy_no_delete
 BEFORE DELETE ON family_points_legacy_links
 BEGIN SELECT RAISE(ABORT,'POINTS_LEGACY_LINK_IMMUTABLE'); END;

INSERT OR IGNORE INTO schema_migrations(version,description)
 VALUES('schema-0034-family-points-foundation','Unexecuted Draft points units/JPY/ratio and immutable event foundation; no legacy backfill');
