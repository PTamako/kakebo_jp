-- 0031: Non-cash CREDIT CARD purchase and payable statement (Draft, UNEXECUTED).
-- No cash transfer, no balance debit, no securities mutation.
-- Each successful purchase is a single shared expense with a separate immutable
-- outstanding card liability. All identity and amount facts have one immutable
-- transaction journal. Settlement is a DIFFERENT future approved operation.
CREATE TABLE IF NOT EXISTS family_card_purchase_intents (
 request_id TEXT PRIMARY KEY NOT NULL CHECK(length(request_id)=32),
 household_id TEXT NOT NULL,
 requester_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 account_version INTEGER NOT NULL CHECK(account_version>=1),
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 payload_cipher TEXT NOT NULL,
 payload_iv TEXT NOT NULL,
 idempotency_hash TEXT NOT NULL UNIQUE CHECK(length(idempotency_hash)=64),
 status TEXT NOT NULL CHECK(status IN ('prepared','submitted','cancelled')),
 homeflow_approval_id TEXT UNIQUE,
 created_at INTEGER NOT NULL,
 expires_at INTEGER NOT NULL CHECK(expires_at>created_at),
 submitted_at INTEGER,
 CHECK(
  (status='prepared' AND homeflow_approval_id IS NULL AND submitted_at IS NULL)
  OR (status='submitted' AND length(homeflow_approval_id)=36 AND submitted_at>0)
  OR (status='cancelled' AND homeflow_approval_id IS NULL AND submitted_at IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_family_card_purchase_member
 ON family_card_purchase_intents(household_id,requester_user_id,created_at DESC);
CREATE TRIGGER IF NOT EXISTS trg_family_card_intent_verified
 BEFORE INSERT ON family_card_purchase_intents
 WHEN NOT EXISTS(SELECT 1 FROM family_financial_accounts a
  JOIN homeflow_identity_links l ON l.user_id=NEW.requester_user_id
  WHERE a.account_id=NEW.account_id AND a.household_id=NEW.household_id
  AND a.owner_user_id=NEW.requester_user_id AND a.origin='member_created'
  AND a.account_kind='credit_card' AND a.version=NEW.account_version
  AND a.is_archived=0 AND l.household_id=NEW.household_id
  AND l.role='member' AND l.state='active')
 BEGIN SELECT RAISE(ABORT,'CARD_INTENT_OWNER_VERSION_INVALID'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_card_intent_identity
 BEFORE UPDATE OF request_id,household_id,requester_user_id,account_id,
 account_version,payload_sha256,payload_cipher,payload_iv,idempotency_hash,
 created_at,expires_at ON family_card_purchase_intents
 BEGIN SELECT RAISE(ABORT,'CARD_INTENT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_card_intent_state
 BEFORE UPDATE ON family_card_purchase_intents
 WHEN NOT (OLD.status='prepared' AND NEW.status IN('submitted','cancelled'))
 BEGIN SELECT RAISE(ABORT,'CARD_INTENT_INVALID_TRANSITION'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_card_intent_delete
 BEFORE DELETE ON family_card_purchase_intents
 BEGIN SELECT RAISE(ABORT,'CARD_INTENT_NO_DELETE'); END;

-- The canonical payable is this immutable charge. It is NOT a cash debit.
-- bill_month means card CLOSING month, not bank withdrawal/due date.
-- Future settlements MUST be linked as new immutable settlement records,
-- never by editing or deleting this charge (prevent double cash counting).
CREATE TABLE IF NOT EXISTS family_card_purchase_applied (
 homeflow_request_id TEXT PRIMARY KEY NOT NULL CHECK(length(homeflow_request_id)=36),
 proposal_id TEXT NOT NULL UNIQUE REFERENCES family_card_purchase_intents(request_id) ON DELETE RESTRICT,
 household_id TEXT NOT NULL,
 requester_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 approver_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 account_version INTEGER NOT NULL CHECK(account_version>=1),
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 client_request_id TEXT NOT NULL UNIQUE,
 entry_id INTEGER NOT NULL UNIQUE REFERENCES entries(id) ON DELETE RESTRICT,
 amount_jpy INTEGER NOT NULL CHECK(amount_jpy BETWEEN 1 AND 10000000),
 purchase_date TEXT NOT NULL CHECK(length(purchase_date)=10),
 bill_month TEXT NOT NULL CHECK(length(bill_month)=7),
 applied_at INTEGER NOT NULL CHECK(applied_at>0),
 CHECK(approver_user_id<>requester_user_id)
);
CREATE INDEX IF NOT EXISTS idx_family_card_statement
 ON family_card_purchase_applied(household_id,account_id,bill_month,applied_at);
CREATE TRIGGER IF NOT EXISTS trg_family_card_applied_match
 BEFORE INSERT ON family_card_purchase_applied
 WHEN NOT EXISTS(
  SELECT 1 FROM entries e
  JOIN family_financial_accounts a ON a.account_id=NEW.account_id
  JOIN family_card_purchase_intents p ON p.request_id=NEW.proposal_id
  JOIN homeflow_identity_links requester ON requester.user_id=NEW.requester_user_id
  JOIN homeflow_identity_links approver ON approver.user_id=NEW.approver_user_id
  WHERE e.id=NEW.entry_id AND e.type='expense'
   AND e.family_account_id=NEW.account_id
   AND e.payment_source='cc:'||NEW.account_id
   AND e.amount=NEW.amount_jpy AND e.date=NEW.purchase_date
   AND e.client_request_id=NEW.client_request_id
   AND p.homeflow_approval_id=NEW.homeflow_request_id
   AND p.status='submitted' AND p.account_version=NEW.account_version
   AND p.account_id=NEW.account_id AND p.household_id=NEW.household_id
   AND p.requester_user_id=NEW.requester_user_id
   AND p.payload_sha256=NEW.payload_sha256
   AND a.owner_user_id=NEW.requester_user_id
   AND a.household_id=NEW.household_id
   AND a.account_kind='credit_card' AND a.origin='member_created'
   AND a.is_archived=0 AND a.version=NEW.account_version
   AND requester.role='member' AND requester.state='active'
   AND approver.role='owner' AND approver.state='active'
   AND requester.household_id=NEW.household_id
   AND approver.household_id=NEW.household_id
 )
 BEGIN SELECT RAISE(ABORT,'CARD_APPLIED_LEDGER_IDENTITY_MISMATCH'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_card_applied_no_update
 BEFORE UPDATE ON family_card_purchase_applied
 BEGIN SELECT RAISE(ABORT,'CARD_APPLIED_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_card_applied_no_delete
 BEFORE DELETE ON family_card_purchase_applied
 BEGIN SELECT RAISE(ABORT,'CARD_APPLIED_IMMUTABLE'); END;

CREATE TABLE IF NOT EXISTS family_card_purchase_audit (
 event_id TEXT PRIMARY KEY NOT NULL,
 homeflow_request_id TEXT NOT NULL REFERENCES family_card_purchase_applied(homeflow_request_id) ON DELETE RESTRICT,
 requester_user_id TEXT NOT NULL,
 approver_user_id TEXT NOT NULL,
 action TEXT NOT NULL CHECK(action='credit_card_purchase_applied'),
 created_at INTEGER NOT NULL
);
CREATE TRIGGER IF NOT EXISTS trg_family_card_audit_actor_match
 BEFORE INSERT ON family_card_purchase_audit
 WHEN NOT EXISTS(SELECT 1 FROM family_card_purchase_applied a
 WHERE a.homeflow_request_id=NEW.homeflow_request_id
 AND a.requester_user_id=NEW.requester_user_id
 AND a.approver_user_id=NEW.approver_user_id)
 BEGIN SELECT RAISE(ABORT,'CARD_APPROVER_AUDIT_MISMATCH'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_card_audit_immutable
 BEFORE UPDATE ON family_card_purchase_audit
 BEGIN SELECT RAISE(ABORT,'CARD_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_family_card_audit_delete
 BEFORE DELETE ON family_card_purchase_audit
 BEGIN SELECT RAISE(ABORT,'CARD_AUDIT_IMMUTABLE'); END;
INSERT OR IGNORE INTO schema_migrations(version,description)
 VALUES('schema-0031-family-card-purchase-execution',
  'Unexecuted approved credit purchases, immutable shared expense and card closing-month liability');
