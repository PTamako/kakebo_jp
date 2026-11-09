# 2026-11-09 kakeibo audit hardening

## Server financial guarantees
- Card-bill recalculate and legacy PUT now share the same registered, active, standard credit-card validation.
- Billing period must match the saved card closing-day setting, including month-end and leap years. Existing card bills are never edited by migration.
- Receipt and statement POST for restore remains insert-only to avoid discarding historical snapshots.

## Scheduled jobs
- Market holidays and weekends write one lightweight NAV status of `skipped` instead of silently leaving no heartbeat.
- The management screen lists recurring, SBI, and NAV independently, explicitly saying when a job has no history.
- NAV provider and D1 valuation writes are unchanged.

## Portable receipt recovery
- A bounded ZIP reader accepts only this application's uncompressed JSON and receipt files; CRC-32, central-directory offsets, file types and size limits are checked before recovery preview.
- JSON SHA-256 checks and duplicate review happen before any D1 write.
- Receipt photos stay on this device. After restoring D1 rows, match the new IDs by deterministic restore request ID plus the entire transaction fingerprint; ambiguous images are safely skipped.
- Already stored device photos are never overwritten. Missing photos and partial failures are reported.
- SHA-256 provides integrity checking, not a cryptographic authenticity signature.

## Release safety
- Public/private repository plan may prevent enforcing branch protection and required status checks. See issue #268. This cannot be solved by source-code changes alone.
- Require PR-only release as an operational rule; check Validate, Mobile WebKit, same-SHA Cloudflare Preview and Production deployment before claiming released.
- Run no financial D1 rebuild, historical reseed, card snapshot rewrite, investment import, or production API write to verify this change.
