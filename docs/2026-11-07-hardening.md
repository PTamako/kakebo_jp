# 2026-11-07 security and financial integrity hardening

- New and edited ledger entries reject unregistered/archived payment sources. Existing historical rows may keep their same archived source when edited.
- Recurring plans reject unknown sources and cannot enable an archived source.
- Saved card bills remain historical snapshots. GET /api/card-bills now returns live server-calculated totals and stale flags; no historical bill is silently overwritten.
- GET /api/job-health is owner-authenticated and exposes only status, timestamps and numeric counts. The scheduled Worker writes minimal heartbeat data into scheduled_job_state. It never stores merchants, amounts or personal notes. Monitoring failures do not prevent the financial job from running.
- Preview/production migration 0019 is additive; restore via D1 Time Travel if needed. Pages and the scheduled NAV Worker are deployed separately.
- Dedicated WebKit smoke covers representative iPhone-sized viewports and reloads, complementing the Node financial regression suite. It does not replace physical iPhone acceptance testing.
- The existing Dependabot configuration runs weekly; the production dependency audit remains release-blocking. Development-only moderate/low alerts should be addressed in separate dependency PRs, without risky untested lockfile edits.
- Operational check: authenticate to 家計簿, open 管理→ツール→定期処理の実行状況 and refresh. Failures appear in red; check the Cloudflare Worker logs when a job fails.
