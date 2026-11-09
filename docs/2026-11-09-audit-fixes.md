# 2026-11-09 kakeibo audit hardening

## Server financial guarantees
- Card-bill recalculate and legacy PUT now share the same registered, active, standard credit-card validation.
- Billing period must match the saved card closing-day setting, including month-end and leap years. Existing card bills are never edited by migration.
- Receipt and statement POST for restore remains insert-only to avoid discarding historical snapshots.

## Scheduled jobs
- Market holidays and weekends write one lightweight NAV status of `skipped` instead of silently leaving no heartbeat.
- The management screen lists recurring, SBI, and NAV independently, explicitly saying when a job has no history.
- NAV provider and D1 valuation writes are unchanged.

## Release safety
- Public/private repository plan may prevent enforcing branch protection and required status checks. See issue #268. This cannot be solved by source-code changes alone.
- Require PR-only release as an operational rule; check Validate, Mobile WebKit, same-SHA Cloudflare Preview and Production deployment before claiming released.
- Run no financial D1 rebuild, historical reseed, card snapshot rewrite, investment import, or production API write to verify this change.
