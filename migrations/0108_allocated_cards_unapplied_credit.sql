-- 0108: a card payment and a redeemed points offset are real, immutable
-- value already credited to their ORIGINAL card. Correcting a household
-- expense must not pretend the bank refunded money or the points issuer
-- restored units. Instead: reverse the expense liability (approved 0100/0106
-- effects) and expose any excess as an unapplied credit on the source card.
-- The new card/bill acquires its own independent payable. No new bank account,
-- duplicate expense, points issuance or mutation of historical allocations.
DROP TRIGGER IF EXISTS trg_future_correction_no_allocated_purchase;

-- Do not let later NEW settlement allocations attach to a charge that was
-- moved away, tombstoned, or reduced after its original immutable approval.
DROP TRIGGER IF EXISTS trg_family_card_allocation_balance;
CREATE TRIGGER trg_family_card_allocation_balance
 BEFORE INSERT ON family_card_settlement_allocations
 WHEN NOT EXISTS(
 SELECT 1 FROM family_card_purchase_applied p
 JOIN entries current ON current.id=p.entry_id
 JOIN family_card_settlements_applied s ON s.homeflow_request_id=NEW.homeflow_request_id
 WHERE p.homeflow_request_id=NEW.purchase_request_id
  AND p.household_id=s.household_id AND p.account_id=s.card_account_id
  AND current.type='expense' AND current.amount>0
  AND current.family_account_id=p.account_id
  AND current.payment_source='cc:'||p.account_id
  AND current.client_request_id='hfcard:'||p.homeflow_request_id
  AND current.date<=s.debit_date
  AND NEW.amount_jpy<=current.amount
    -COALESCE((SELECT SUM(a.amount_jpy) FROM family_card_settlement_allocations a
      WHERE a.purchase_request_id=NEW.purchase_request_id),0)
    -COALESCE((SELECT SUM(o.amount_jpy-
       COALESCE((SELECT SUM(r.restored_jpy)
         FROM family_points_card_offset_refunds r
         WHERE r.original_request_id=o.homeflow_request_id),0))
      FROM family_points_card_offsets o
      WHERE o.purchase_request_id=NEW.purchase_request_id),0)
 )
 BEGIN SELECT RAISE(ABORT,'CARD_SETTLEMENT_CURRENT_BALANCE_OR_SOURCE_INVALID'); END;

-- Old journals reference historical purchase IDs; a NEW points redemption
-- cannot claim a card which no longer owns the physical household expense.
-- Existing offsets and their explicit refund path remain immutable/untouched.
CREATE TRIGGER IF NOT EXISTS trg_future_point_offset_current_source
 BEFORE INSERT ON family_points_card_offsets
 WHEN NOT EXISTS(
  SELECT 1 FROM family_card_purchase_applied p
  JOIN entries current ON current.id=p.entry_id
  WHERE p.homeflow_request_id=NEW.purchase_request_id
   AND p.household_id=NEW.household_id
   AND p.account_id=NEW.card_account_id
   AND current.type='expense' AND current.amount>0
   AND current.family_account_id=p.account_id
   AND current.payment_source='cc:'||p.account_id
   AND current.client_request_id='hfcard:'||p.homeflow_request_id
   AND current.date<=NEW.effective_date
   AND NEW.amount_jpy<=current.amount
     -COALESCE((SELECT SUM(a.amount_jpy) FROM family_card_settlement_allocations a
       WHERE a.purchase_request_id=NEW.purchase_request_id),0)
     -COALESCE((SELECT SUM(o.amount_jpy-
        COALESCE((SELECT SUM(r.restored_jpy)
         FROM family_points_card_offset_refunds r
         WHERE r.original_request_id=o.homeflow_request_id),0))
       FROM family_points_card_offsets o
       WHERE o.purchase_request_id=NEW.purchase_request_id),0)
 )
 BEGIN SELECT RAISE(ABORT,'POINTS_OFFSET_CURRENT_BALANCE_OR_SOURCE_INVALID'); END;

INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(
 'schema-0108-allocated-cards-unapplied-credit',
 'Keep real bank and points credits on original card after signed invoice corrections; reject future allocations to moved invoices');
