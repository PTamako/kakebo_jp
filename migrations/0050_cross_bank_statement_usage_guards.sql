-- 0050 DRAFT: protect original posted bank evidence in BOTH directions across
-- 0048 same-owner transfer, 0049 cross-member transfer, card debit and SBI.
-- Additive migration only. No remote bank verification and no money movement.
CREATE TRIGGER IF NOT EXISTS trg_cross_bank_prior_statement_reuse
BEFORE INSERT ON family_cross_bank_journal
WHEN EXISTS(
 SELECT 1 FROM family_bank_transfer_posted_evidence e
 WHERE (e.source_account_id=NEW.source_account_id AND e.source_reference_hash=NEW.source_reference_hash)
    OR (e.target_account_id=NEW.source_account_id AND e.target_reference_hash=NEW.source_reference_hash)
    OR (e.source_account_id=NEW.target_account_id AND e.source_reference_hash=NEW.credit_reference_hash)
    OR (e.target_account_id=NEW.target_account_id AND e.target_reference_hash=NEW.credit_reference_hash)
) OR EXISTS(
 SELECT 1 FROM family_card_bank_debit_evidence e
 WHERE (e.bank_account_id=NEW.source_account_id AND e.reference_hash=NEW.source_reference_hash)
    OR (e.bank_account_id=NEW.target_account_id AND e.reference_hash=NEW.credit_reference_hash)
) OR EXISTS(
 SELECT 1 FROM family_sbi_cash_bank_evidence e
 WHERE (e.bank_account_id=NEW.source_account_id AND e.reference_hash=NEW.source_reference_hash)
    OR (e.bank_account_id=NEW.target_account_id AND e.reference_hash=NEW.credit_reference_hash)
) OR EXISTS(
 SELECT 1 FROM family_sbi_cash_refund_evidence e
 WHERE (e.bank_account_id=NEW.source_account_id AND e.bank_refund_hash=NEW.source_reference_hash)
    OR (e.bank_account_id=NEW.target_account_id AND e.bank_refund_hash=NEW.credit_reference_hash)
) OR EXISTS(
 SELECT 1 FROM family_cross_bank_journal previous
 WHERE (previous.source_account_id=NEW.source_account_id AND previous.source_reference_hash=NEW.source_reference_hash)
    OR (previous.target_account_id=NEW.source_account_id AND previous.credit_reference_hash=NEW.source_reference_hash)
    OR (previous.source_account_id=NEW.target_account_id AND previous.source_reference_hash=NEW.credit_reference_hash)
    OR (previous.target_account_id=NEW.target_account_id AND previous.credit_reference_hash=NEW.credit_reference_hash)
)
BEGIN SELECT RAISE(ABORT,'CROSS_BANK_STATEMENT_PRIOR_USE'); END;

-- A cross-member journal is immutable; old financial writers MUST NOT reuse a
-- confirmed source debit or confirmed recipient credit afterward.
CREATE TRIGGER IF NOT EXISTS trg_cross_bank_no_later_same_owner_transfer
BEFORE INSERT ON family_bank_transfer_posted_evidence
WHEN EXISTS(
 SELECT 1 FROM family_cross_bank_journal j
 WHERE (j.source_account_id=NEW.source_account_id AND j.source_reference_hash=NEW.source_reference_hash)
    OR (j.target_account_id=NEW.source_account_id AND j.credit_reference_hash=NEW.source_reference_hash)
    OR (j.source_account_id=NEW.target_account_id AND j.source_reference_hash=NEW.target_reference_hash)
    OR (j.target_account_id=NEW.target_account_id AND j.credit_reference_hash=NEW.target_reference_hash)
)
BEGIN SELECT RAISE(ABORT,'CROSS_BANK_STATEMENT_ALREADY_USED'); END;
CREATE TRIGGER IF NOT EXISTS trg_cross_bank_no_later_card_debit
BEFORE INSERT ON family_card_bank_debit_evidence
WHEN EXISTS(
 SELECT 1 FROM family_cross_bank_journal j
 WHERE (j.source_account_id=NEW.bank_account_id AND j.source_reference_hash=NEW.reference_hash)
    OR (j.target_account_id=NEW.bank_account_id AND j.credit_reference_hash=NEW.reference_hash)
)
BEGIN SELECT RAISE(ABORT,'CROSS_BANK_STATEMENT_ALREADY_USED'); END;
CREATE TRIGGER IF NOT EXISTS trg_cross_bank_no_later_sbi_debit
BEFORE INSERT ON family_sbi_cash_bank_evidence
WHEN EXISTS(
 SELECT 1 FROM family_cross_bank_journal j
 WHERE (j.source_account_id=NEW.bank_account_id AND j.source_reference_hash=NEW.reference_hash)
    OR (j.target_account_id=NEW.bank_account_id AND j.credit_reference_hash=NEW.reference_hash)
)
BEGIN SELECT RAISE(ABORT,'CROSS_BANK_STATEMENT_ALREADY_USED'); END;
CREATE TRIGGER IF NOT EXISTS trg_cross_bank_no_later_sbi_refund
BEFORE INSERT ON family_sbi_cash_refund_evidence
WHEN EXISTS(
 SELECT 1 FROM family_cross_bank_journal j
 WHERE (j.source_account_id=NEW.bank_account_id AND j.source_reference_hash=NEW.bank_refund_hash)
    OR (j.target_account_id=NEW.bank_account_id AND j.credit_reference_hash=NEW.bank_refund_hash)
)
BEGIN SELECT RAISE(ABORT,'CROSS_BANK_STATEMENT_ALREADY_USED'); END;
INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(
 'schema-0050-cross-bank-statement-usage-guards',
 'UNDEPLOYED bilateral anti-replay guards for cross-member bank and SBI/card/same-owner evidence');
