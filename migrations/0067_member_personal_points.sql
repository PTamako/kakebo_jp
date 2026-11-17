-- 0067: personal points source records WITHOUT household owner review.
-- This is NOT bank money, issuer API confirmation, credit-card settlement,
-- prepaid top-up, or SBI execution. Only campaign accrual, expiration and
-- exact immutable correction of those two operations are allowed.
CREATE TABLE IF NOT EXISTS family_points_direct_personal_proofs (
 homeflow_request_id TEXT PRIMARY KEY CHECK(length(homeflow_request_id)=36),
 proposal_id TEXT NOT NULL UNIQUE REFERENCES family_points_intents(request_id) ON DELETE RESTRICT,
 household_id TEXT NOT NULL,
 owner_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 points_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 account_version INTEGER NOT NULL CHECK(account_version>=1),
 operation TEXT NOT NULL CHECK(operation IN('earn_campaign','expire','reversal')),
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 source_reference_hash TEXT NOT NULL CHECK(length(source_reference_hash)=64),
 created_at INTEGER NOT NULL CHECK(created_at>0),
 UNIQUE(points_account_id,source_reference_hash)
);
CREATE TRIGGER IF NOT EXISTS trg_points_direct_personal_proof_guard
 BEFORE INSERT ON family_points_direct_personal_proofs
 WHEN NOT EXISTS (
  SELECT 1 FROM family_points_intents i
  JOIN family_financial_accounts a ON a.account_id=i.points_account_id
  JOIN homeflow_identity_links u ON u.user_id=i.requester_user_id
  WHERE i.request_id=NEW.proposal_id AND i.homeflow_approval_id=NEW.homeflow_request_id
   AND i.status='submitted' AND i.household_id=NEW.household_id
   AND i.requester_user_id=NEW.owner_user_id
   AND i.points_account_id=NEW.points_account_id
   AND i.expected_version=NEW.account_version
   AND i.operation=NEW.operation AND i.payload_sha256=NEW.payload_sha256
   AND i.expires_at>NEW.created_at
   AND a.account_kind='points' AND a.origin='member_created'
   AND a.owner_user_id=NEW.owner_user_id AND a.household_id=NEW.household_id
   AND a.is_archived=0 AND a.opening_balance=0 AND a.version=NEW.account_version
   AND u.role='member' AND u.state='active' AND u.household_id=NEW.household_id
 )
 BEGIN SELECT RAISE(ABORT,'PERSONAL_POINTS_PROOF_INVALID'); END;
CREATE TRIGGER IF NOT EXISTS trg_points_direct_personal_proof_no_update
 BEFORE UPDATE ON family_points_direct_personal_proofs
 BEGIN SELECT RAISE(ABORT,'PERSONAL_POINTS_PROOF_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_points_direct_personal_proof_no_delete
 BEFORE DELETE ON family_points_direct_personal_proofs
 BEGIN SELECT RAISE(ABORT,'PERSONAL_POINTS_PROOF_IMMUTABLE'); END;
-- Keep the ENTIRE audited counterpart, balance, version and replay guard.
-- Only the approver-type branch changes, requiring the immutable personal proof.
DROP TRIGGER IF EXISTS trg_family_points_journal_guard;
CREATE TRIGGER trg_family_points_journal_guard
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
    AND approver.state='active' AND approver.household_id=NEW.household_id
    AND NEW.actor_user_id=NEW.approver_user_id
    AND (
      (approver.role='owner' AND NEW.approver_user_id<>NEW.requester_user_id)
      OR (approver.role='member' AND NEW.approver_user_id=NEW.requester_user_id
       AND NEW.operation IN ('earn_campaign','expire','reversal')
       AND NEW.yen_value IS NULL AND NEW.yen_per_unit_numerator IS NULL
       AND NEW.yen_per_unit_denominator IS NULL
       AND NEW.target_account_id IS NULL AND NEW.linked_entry_id IS NULL
       AND EXISTS (
        SELECT 1 FROM family_points_direct_personal_proofs proof
        WHERE proof.homeflow_request_id=NEW.homeflow_request_id
         AND proof.proposal_id=NEW.proposal_id
         AND proof.household_id=NEW.household_id
         AND proof.owner_user_id=NEW.requester_user_id
         AND proof.points_account_id=NEW.points_account_id
         AND proof.account_version=NEW.account_version
         AND proof.operation=NEW.operation
         AND proof.payload_sha256=NEW.payload_sha256
         AND proof.source_reference_hash=NEW.source_reference_hash
         AND NEW.applied_at>=proof.created_at
         AND NEW.applied_at-proof.created_at<=600000
       ))
    )
 )
 OR NEW.balance_after_units<>COALESCE(
     (SELECT SUM(delta_units) FROM family_points_journal
      WHERE points_account_id=NEW.points_account_id),0)
   +COALESCE((SELECT SUM(c.target_units) FROM family_points_transfer_credits c
      WHERE c.target_account_id=NEW.points_account_id),0)
   -COALESCE((SELECT SUM(r.debited_target_units) FROM family_points_transfer_refunds r
      WHERE r.target_account_id=NEW.points_account_id),0)+NEW.delta_units
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
         WHEN NEW.operation='transfer_prepaid' OR (NEW.operation='reversal' AND EXISTS(
           SELECT 1 FROM family_points_journal parent
           WHERE parent.homeflow_request_id=NEW.reversed_request_id
             AND parent.operation='transfer_prepaid')) THEN 'prepaid'
         WHEN NEW.operation='offset_card' OR (NEW.operation='reversal' AND EXISTS(
           SELECT 1 FROM family_points_journal parent
           WHERE parent.homeflow_request_id=NEW.reversed_request_id
             AND parent.operation='offset_card')) THEN 'credit_card'
         WHEN NEW.operation='redeem_asset' OR (NEW.operation='reversal' AND EXISTS(
           SELECT 1 FROM family_points_journal parent
           WHERE parent.homeflow_request_id=NEW.reversed_request_id
             AND parent.operation='redeem_asset')) THEN 'securities'
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
INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(
 'schema-0067-member-personal-points',
 'Self-attested member points earn/expire/reversal with immutable proof, CAS, audit and zero household entry writes'
);
