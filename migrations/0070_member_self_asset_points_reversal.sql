-- 0070: full reversal of a PRIOR MEMBER-SELF-POSTED points asset event.
-- Requires issuer-side refund AND target-side reversal confirmations, never
-- changes original journal or sends a broker order. Every refund counterpart
-- is still enforced by the existing immutable, same-D1 AFTER INSERT triggers.
CREATE TABLE IF NOT EXISTS family_points_direct_asset_refund_proofs (
 homeflow_request_id TEXT PRIMARY KEY CHECK(length(homeflow_request_id)=36),
 proposal_id TEXT NOT NULL UNIQUE REFERENCES family_points_intents(request_id) ON DELETE RESTRICT,
 original_request_id TEXT NOT NULL UNIQUE REFERENCES family_points_journal(homeflow_request_id) ON DELETE RESTRICT,
 household_id TEXT NOT NULL,
 owner_user_id TEXT NOT NULL REFERENCES homeflow_identity_links(user_id) ON DELETE RESTRICT,
 points_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 account_version INTEGER NOT NULL CHECK(account_version>=1),
 original_operation TEXT NOT NULL CHECK(original_operation IN
 ('transfer_prepaid','offset_card','redeem_asset','transfer_out','exchange_out')),
 target_account_id TEXT NOT NULL REFERENCES family_financial_accounts(account_id) ON DELETE RESTRICT,
 target_version INTEGER NOT NULL CHECK(target_version>=1),
 refund_units INTEGER NOT NULL CHECK(refund_units BETWEEN 1 AND 1000000000),
 yen_value INTEGER NOT NULL CHECK(yen_value BETWEEN 1 AND 10000000),
 payload_sha256 TEXT NOT NULL CHECK(length(payload_sha256)=64),
 source_reference_hash TEXT NOT NULL CHECK(length(source_reference_hash)=64),
 created_at INTEGER NOT NULL CHECK(created_at>0),
 UNIQUE(points_account_id,source_reference_hash)
);
CREATE TRIGGER IF NOT EXISTS trg_points_direct_asset_refund_proof_guard
 BEFORE INSERT ON family_points_direct_asset_refund_proofs
 WHEN NOT EXISTS(
  SELECT 1 FROM family_points_intents intent
  JOIN family_points_journal original ON original.homeflow_request_id=NEW.original_request_id
  JOIN family_points_direct_asset_proofs original_proof
   ON original_proof.homeflow_request_id=original.homeflow_request_id
  JOIN family_financial_accounts source ON source.account_id=NEW.points_account_id
  JOIN family_financial_accounts target ON target.account_id=NEW.target_account_id
  JOIN homeflow_identity_links member ON member.user_id=NEW.owner_user_id
  WHERE intent.request_id=NEW.proposal_id
   AND intent.homeflow_approval_id=NEW.homeflow_request_id
   AND intent.status='submitted' AND intent.original_request_id=NEW.original_request_id
   AND intent.operation='reversal' AND intent.household_id=NEW.household_id
   AND intent.requester_user_id=NEW.owner_user_id
   AND intent.points_account_id=NEW.points_account_id
   AND intent.expected_version=NEW.account_version
   AND intent.payload_sha256=NEW.payload_sha256
   AND intent.expires_at>NEW.created_at
   AND original.operation=NEW.original_operation
   AND original.household_id=NEW.household_id
   AND original.requester_user_id=NEW.owner_user_id
   AND original.points_account_id=NEW.points_account_id
   AND original.target_account_id=NEW.target_account_id
   AND original.delta_units=-NEW.refund_units
   AND original.yen_value=NEW.yen_value
   AND original_proof.owner_user_id=NEW.owner_user_id
   AND original_proof.household_id=NEW.household_id
   AND original_proof.points_account_id=NEW.points_account_id
   AND original_proof.target_account_id=NEW.target_account_id
   AND NOT EXISTS(SELECT 1 FROM family_points_journal previously
    WHERE previously.reversed_request_id=original.homeflow_request_id)
   AND source.household_id=NEW.household_id AND source.owner_user_id=NEW.owner_user_id
   AND source.account_kind='points' AND source.origin='member_created'
   AND source.version=NEW.account_version AND source.opening_balance=0
   AND source.is_archived=0
   AND target.household_id=NEW.household_id AND target.owner_user_id=NEW.owner_user_id
   AND target.origin='member_created' AND target.version=NEW.target_version
   AND target.opening_balance=0 AND target.is_archived=0
   AND target.account_kind=CASE
     WHEN NEW.original_operation='transfer_prepaid' THEN 'prepaid'
     WHEN NEW.original_operation='offset_card' THEN 'credit_card'
     WHEN NEW.original_operation='redeem_asset' THEN 'securities'
     ELSE 'points' END
   AND member.role='member' AND member.state='active'
   AND member.household_id=NEW.household_id
 )
 BEGIN SELECT RAISE(ABORT,'PERSONAL_ASSET_REFUND_PROOF_INVALID'); END;
CREATE TRIGGER IF NOT EXISTS trg_points_direct_asset_refund_proof_no_update
 BEFORE UPDATE ON family_points_direct_asset_refund_proofs
 BEGIN SELECT RAISE(ABORT,'PERSONAL_ASSET_REFUND_PROOF_IMMUTABLE'); END;
CREATE TRIGGER IF NOT EXISTS trg_points_direct_asset_refund_proof_no_delete
 BEFORE DELETE ON family_points_direct_asset_refund_proofs
 BEGIN SELECT RAISE(ABORT,'PERSONAL_ASSET_REFUND_PROOF_IMMUTABLE'); END;
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
      OR (approver.role='member' AND NEW.approver_user_id=NEW.requester_user_id
       AND NEW.operation='reversal' AND NEW.reversed_request_id IS NOT NULL
       AND NEW.linked_entry_id IS NULL AND NEW.target_account_id IS NOT NULL
       AND NEW.delta_units>0 AND NEW.yen_value BETWEEN 1 AND 10000000
       AND EXISTS(
        SELECT 1 FROM family_points_direct_asset_refund_proofs proof
        WHERE proof.homeflow_request_id=NEW.homeflow_request_id
         AND proof.proposal_id=NEW.proposal_id
         AND proof.original_request_id=NEW.reversed_request_id
         AND proof.household_id=NEW.household_id
         AND proof.owner_user_id=NEW.requester_user_id
         AND proof.points_account_id=NEW.points_account_id
         AND proof.account_version=NEW.account_version
         AND proof.target_account_id=NEW.target_account_id
         AND proof.refund_units=NEW.delta_units
         AND proof.yen_value=NEW.yen_value
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
-- SBI's old owner-signed branch is preserved verbatim. The new member branch
-- requires the original member proof and this exact immutable reversal proof.
DROP TRIGGER IF EXISTS trg_sbi_point_refund_guard;
CREATE TRIGGER trg_sbi_point_refund_guard BEFORE INSERT ON family_sbi_point_refunds
 WHEN NOT EXISTS(
 SELECT 1 FROM family_points_journal correction
 JOIN family_points_journal orig ON orig.homeflow_request_id=NEW.original_request_id
 JOIN family_sbi_point_lots lot ON lot.homeflow_request_id=orig.homeflow_request_id
 JOIN family_points_intents intent ON intent.request_id=correction.proposal_id
 JOIN family_financial_accounts sec ON sec.account_id=NEW.securities_account_id
 JOIN homeflow_identity_links member ON member.user_id=NEW.requester_user_id
 JOIN homeflow_identity_links owner ON owner.user_id=NEW.approver_user_id
 WHERE correction.homeflow_request_id=NEW.homeflow_request_id
 AND correction.operation='reversal' AND correction.reversed_request_id=orig.homeflow_request_id
 AND correction.delta_units=-orig.delta_units AND correction.delta_units=NEW.refunded_points_units
 AND correction.delta_units>0 AND correction.yen_value=NEW.reversed_cost_jpy
 AND correction.household_id=NEW.household_id AND correction.requester_user_id=NEW.requester_user_id
 AND correction.points_account_id=NEW.points_account_id AND correction.target_account_id=NEW.securities_account_id
 AND correction.approver_user_id=NEW.approver_user_id AND correction.actor_user_id=NEW.actor_user_id
 AND correction.effective_date=NEW.effective_date AND correction.applied_at=NEW.created_at
 AND orig.operation='redeem_asset' AND orig.yen_value=NEW.reversed_cost_jpy
 AND orig.points_account_id=NEW.points_account_id AND orig.target_account_id=NEW.securities_account_id
 AND orig.household_id=NEW.household_id AND orig.requester_user_id=NEW.requester_user_id
 AND lot.points_account_id=NEW.points_account_id AND lot.securities_account_id=NEW.securities_account_id
 AND lot.owner_user_id=NEW.requester_user_id AND lot.household_id=NEW.household_id
 AND lot.confirmed_units=NEW.reversed_units AND lot.acquisition_cost_jpy=NEW.reversed_cost_jpy
 AND lot.trade_date<=NEW.broker_cancel_date
 AND lot.broker_reference_hash<>NEW.broker_cancel_hash
 AND intent.original_request_id=orig.homeflow_request_id
 AND intent.sbi_refund_securities_version=NEW.securities_version
 AND intent.sbi_refund_broker_hash=NEW.broker_cancel_hash
 AND intent.sbi_refund_points_hash=NEW.points_refund_hash
 AND intent.sbi_refund_broker_date=NEW.broker_cancel_date
 AND intent.sbi_refund_points_date=NEW.points_refund_date
 AND correction.source_reference_hash=NEW.points_refund_hash
 AND sec.household_id=NEW.household_id AND sec.owner_user_id=NEW.requester_user_id
 AND sec.origin='member_created' AND sec.account_kind='securities'
 AND sec.version=NEW.securities_version AND sec.is_archived=0 AND sec.opening_balance=0
 AND member.household_id=NEW.household_id AND member.state='active' AND member.role='member'
 AND owner.household_id=NEW.household_id AND owner.state='active'
 AND NEW.actor_user_id=NEW.approver_user_id
 AND (
  (owner.role='owner' AND NEW.approver_user_id<>NEW.requester_user_id)
  OR (owner.role='member' AND NEW.approver_user_id=NEW.requester_user_id
   AND EXISTS(SELECT 1 FROM family_points_direct_asset_refund_proofs proof
    JOIN family_points_direct_asset_proofs origproof
      ON origproof.homeflow_request_id=proof.original_request_id
    WHERE proof.homeflow_request_id=NEW.homeflow_request_id
     AND proof.original_request_id=NEW.original_request_id
     AND origproof.owner_user_id=NEW.requester_user_id
     AND origproof.operation='redeem_asset'
     AND proof.owner_user_id=NEW.requester_user_id
     AND proof.household_id=NEW.household_id
     AND proof.target_account_id=NEW.securities_account_id
     AND proof.yen_value=NEW.reversed_cost_jpy
     AND proof.refund_units=NEW.refunded_points_units))
 )
 AND NOT EXISTS(SELECT 1 FROM family_sbi_legacy_holding_candidates c
  WHERE c.lot_type='points' AND c.lot_homeflow_request_id=orig.homeflow_request_id)
 AND NOT EXISTS(SELECT 1 FROM family_points_journal prior
  WHERE prior.points_account_id=NEW.points_account_id
   AND prior.source_reference_hash=NEW.points_refund_hash AND prior.homeflow_request_id<>NEW.homeflow_request_id)
 )
 BEGIN SELECT RAISE(ABORT,'SBI_POINT_REFUND_COUNTERPART_OR_IDENTITY_INVALID'); END;
INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(
 'schema-0070-member-self-asset-points-reversal',
 'Member-only fully evidenced source and counterpart refund in existing immutable atomic journal'
);
