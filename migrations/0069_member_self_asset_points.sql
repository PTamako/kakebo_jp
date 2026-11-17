-- 0069: member-controlled unit-to-asset transfers. Authorizes only a member's
-- own origin and own target account. This does not contact an issuer/broker.
-- Existing immutable counterpart triggers remain responsible for posting the
-- prepaid credit, card liability offset, point-to-point credit or SBI lot.
CREATE TABLE IF NOT EXISTS family_points_direct_asset_proofs (
 homeflow_request_id TEXT PRIMARY KEY CHECK(length(homeflow_request_id)=36),
 proposal_id TEXT NOT NULL UNIQUE REFERENCES family_points_intents(request_id) ON DELETE RESTRICT,
 household_id TEXT NOT NULL,
 owner_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 points_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 account_version INTEGER NOT NULL CHECK(account_version>=1),
 operation TEXT NOT NULL CHECK(operation IN
 ('transfer_prepaid','offset_card','redeem_asset','transfer_out','exchange_out')),
 target_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 target_version INTEGER NOT NULL CHECK(target_version>=1),
 target_purchase_request_id TEXT,
 yen_value INTEGER NOT NULL CHECK(yen_value BETWEEN 1 AND 10000000),
 points_units INTEGER NOT NULL CHECK(points_units BETWEEN 1 AND 1000000000),
 yen_per_unit_numerator INTEGER NOT NULL CHECK(yen_per_unit_numerator BETWEEN 1 AND 1000000000),
 yen_per_unit_denominator INTEGER NOT NULL CHECK(yen_per_unit_denominator BETWEEN 1 AND 1000000000),
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 source_reference_hash TEXT NOT NULL CHECK(length(source_reference_hash)=64),
 created_at INTEGER NOT NULL CHECK(created_at>0),
 UNIQUE(points_account_id,source_reference_hash),
 CHECK((operation='offset_card' AND target_purchase_request_id IS NOT NULL)
  OR (operation<>'offset_card' AND target_purchase_request_id IS NULL)),
 CHECK(points_units*yen_per_unit_numerator=yen_value*yen_per_unit_denominator),
 CHECK(points_account_id<>target_account_id)
);
CREATE TRIGGER IF NOT EXISTS trg_points_direct_asset_proof_guard
 BEFORE INSERT ON family_points_direct_asset_proofs
 WHEN NOT EXISTS (
  SELECT 1 FROM family_points_intents i
  JOIN family_financial_accounts src ON src.account_id=i.points_account_id
  JOIN family_financial_accounts dest ON dest.account_id=NEW.target_account_id
  JOIN homeflow_identity_links member ON member.user_id=i.requester_user_id
  WHERE i.request_id=NEW.proposal_id
   AND i.homeflow_approval_id=NEW.homeflow_request_id
   AND i.status='submitted'
   AND i.household_id=NEW.household_id
   AND i.requester_user_id=NEW.owner_user_id
   AND i.points_account_id=NEW.points_account_id
   AND i.expected_version=NEW.account_version
   AND i.operation=NEW.operation
   AND i.payload_sha256=NEW.payload_sha256
   AND i.target_account_id=NEW.target_account_id
   AND i.target_version=NEW.target_version
   AND i.target_purchase_request_id IS NEW.target_purchase_request_id
   AND i.expires_at>NEW.created_at
   AND src.account_kind='points' AND src.origin='member_created'
   AND src.owner_user_id=NEW.owner_user_id AND src.household_id=NEW.household_id
   AND src.version=NEW.account_version AND src.opening_balance=0 AND src.is_archived=0
   AND dest.account_kind=CASE
     WHEN NEW.operation='transfer_prepaid' THEN 'prepaid'
     WHEN NEW.operation='offset_card' THEN 'credit_card'
     WHEN NEW.operation='redeem_asset' THEN 'securities'
     ELSE 'points' END
   AND dest.origin='member_created' AND dest.owner_user_id=NEW.owner_user_id
   AND dest.household_id=NEW.household_id AND dest.is_archived=0
   AND dest.version=NEW.target_version AND dest.opening_balance=0
   AND member.role='member' AND member.state='active'
   AND member.household_id=NEW.household_id
 )
 BEGIN SELECT RAISE(ABORT,'PERSONAL_POINTS_ASSET_PROOF_INVALID'); END;
CREATE TRIGGER IF NOT EXISTS trg_points_direct_asset_proof_immutable_update
 BEFORE UPDATE ON family_points_direct_asset_proofs
 BEGIN SELECT RAISE(ABORT,'PERSONAL_POINTS_ASSET_PROOF_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_points_direct_asset_proof_immutable_delete
 BEFORE DELETE ON family_points_direct_asset_proofs
 BEGIN SELECT RAISE(ABORT,'PERSONAL_POINTS_ASSET_PROOF_IMMUTABLE'); END;
-- Preserve all original journal invariants; add only the new member-owned
-- attested asset-counterpart branch, requiring immutable proof in this batch.
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
      OR (approver.role='member' AND NEW.approver_user_id=NEW.requester_user_id
       AND NEW.operation IN ('transfer_prepaid','offset_card','redeem_asset','transfer_out','exchange_out')
       AND NEW.yen_value BETWEEN 1 AND 10000000
       AND NEW.yen_per_unit_numerator BETWEEN 1 AND 1000000000
       AND NEW.yen_per_unit_denominator BETWEEN 1 AND 1000000000
       AND NEW.linked_entry_id IS NULL AND NEW.target_account_id IS NOT NULL
       AND EXISTS (
        SELECT 1 FROM family_points_direct_asset_proofs proof
        WHERE proof.homeflow_request_id=NEW.homeflow_request_id
         AND proof.proposal_id=NEW.proposal_id
         AND proof.household_id=NEW.household_id
         AND proof.owner_user_id=NEW.requester_user_id
         AND proof.points_account_id=NEW.points_account_id
         AND proof.account_version=NEW.account_version
         AND proof.operation=NEW.operation
         AND proof.payload_sha256=NEW.payload_sha256
         AND proof.source_reference_hash=NEW.source_reference_hash
         AND proof.target_account_id=NEW.target_account_id
         AND proof.yen_value=NEW.yen_value
         AND proof.points_units=-NEW.delta_units
         AND proof.yen_per_unit_numerator=NEW.yen_per_unit_numerator
         AND proof.yen_per_unit_denominator=NEW.yen_per_unit_denominator
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
 'schema-0069-member-self-asset-points',
 'Member-only point asset counterpart posting with immutable proof and same-D1 atomicity'
);
