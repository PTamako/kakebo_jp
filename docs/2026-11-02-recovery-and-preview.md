# 2026-11-02: D1, Preview, NAV and recovery validation

## Production safety
- Main D1 name: `kakebo`; do not import schema.sql or default fixture into production.
- `rules` is the **authoritative 775-keyword fallback dictionary**. `merchant_rules` provides higher-priority user overrides.
- A complete export from `GET /api/backup-snapshot` is authenticated. The /api middleware augments it with `defaultRules` from D1 and refuses to export if the dictionary is empty.
- The restore pipeline accepts older backups without `defaultRules`. New backups restore these via bounded INSERT OR IGNORE, preserving existing mappings and payment/category overrides.
- Fresh D1: create schema, then import a verified complete ledger JSON backup, including `defaultRules`, using the application. Never seed with a stale test fixture.

## Cloudflare Preview
- Preview database: `kakebo_preview`, isolated from production (different D1 UUID).
- Preview contains an empty schema and an `environment_identity` marker, **no production ledger records**.
- Preview variables `APP_ENV`, `PREVIEW_D1_ISOLATED`, `PREVIEW_D1_ID`, `PRODUCTION_D1_ID` must be set together with the Preview D1 binding. Updating only env_vars in a Pages PATCH may reset the binding to production.
- Preview AUTH_TOKEN is intentionally unset until a dedicated non-production credential is provided. Until then, preview API access stays restricted.
- Reconfirm both Preview and Production D1 IDs after any Pages setting patch, and after preview builds.

## Historical manual schema tracking
Production `schema_migrations` now has additional idempotent, **post-facto schema verification** records for 0007, 0008, 0010, 0011, 0012, 0013 and 0014. These are not assertions that the old migration scripts were rerun. The legacy 0009 table has been retired in favor of unified `trash_items`.

## NAV Worker
The existing worker schedules remain 00:30 and 09:30 JST for fixed expenses; 21:00 and 23:15 JST for NAV. The NAV code bypasses provider fetches on Japanese weekends and statutory holidays, while recurring-expense workday exclusion is unchanged. NASDAQ100 remains manual with a link to the fund manager's verified official site.

## Dependency risks
Cloudflare `npm ci` reported two low and eight moderate advisories on 2026-11-02. The production high-severity gate passed. Do not blindly edit package-lock or suppress audit; identify affected packages with a current complete `npm audit --json` and use a reproducible `npm ci && npm run build` check before upgrading.
