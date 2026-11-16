# Stage F G7 — Private issuer statement comparison (read-only; NOT institution verified)

This file documents the additive comparator `scripts/official-evidence-match.mjs`.
It does NOT connect to a bank, SBI or a points issuer, change a financial journal,
claim source authenticity, or set `institution_reconciled=true`. Do NOT execute
against production data until user-supplied official evidence and scope are approved.

## Input custody and normalization

1. Obtain an actual transaction statement from the institution's authenticated
   web portal or a specifically authorized read-only provider API. Record issuer,
   download/signature timestamp, original file byte SHA-256, period, currency,
   proof of official origin and privacy/retention controls **outside GitHub**.
   Never upload account passwords, initial PIN letters or bank credentials.
2. Keep original PDF/CSV in approved encrypted private storage. Normalize each
   **real** transaction locally into:
   `provider` (`bank|sbi|points`), `account_token` (an opaque stable alias,
   never an account number), `reference` (issuer transaction ID),
   `occurred_on`, `posted_on` (real YYYY-MM-DD), `currency` (`JPY|POINTS`),
   `amount_minor` (signed exact integer), and optional
   `asset_code`, `units_micros`, `cost_minor`, `reversal_of`.
   SBI requires exact `asset_code`, `units_micros` and `cost_minor`;
   never invent fractions, trade IDs, NAV or buy dates from screenshots.
3. Independently query the original, immutable internal D1 journal in
   read-only mode and normalize to the same fields; do not alter ledger rows.
   Both datasets must remain private. The comparator requires the original
   file **bytes** so its report is bound to `source_sha256`.
4. Compare using `compareInstitutionEvidence({provider,source_bytes,
   external_rows,internal_rows})`. The pure function performs no network or D1
   calls and returns only bounded counts and SHA-256 reference digests:
   `matched`, `unmatched`, `amount_or_date_conflict`,
   `duplicate_reference`, `reversal_required`. Duplicate original IDs
   are reported, never silently deduplicated.
5. Separately verify the source is **really** from the issuer, inspect every
   exception, verify reversal authorization, capture independent spouse
   confirmations where required and store signed approval evidence privately.
   Matching numbers alone never prove bank/SBI execution. The comparator
   **always returns `institution_reconciled:false`**.
6. Never put original files, full account numbers, official transaction
   references, tokens, password letters, full hashes containing PII context
   or transaction amounts in GitHub issue/CI logs. Only publish aggregate
   status and non-sensitive release-gate results in the handoff.

## Current limitations

- No official bank/SBI/points statement CSV/PDF or API has yet been validated
  against the actual Stage F immutable journals. This module is a comparison
  primitive, **not a complete issuer adapter or completed G7 verification**.
- CSV/PDF extraction, real provider authentication and provenance capture,
  original raw evidence custody, historical transaction mapping and
  human-signed reconciliation are still mandatory.
- The previously located `SBI.pdf` in private Drive is an **account-opening
  letter containing credentials, not a transaction statement**. Its secrets
  must not be reproduced in repo files or issue comments; user has been alerted.
- Do not mark G7 PASS or merge/deploy because these synthetic tests pass.
