-- MANUAL-ONLY destructive cleanup. DO NOT run through Cloudflare Pages builds.
-- Before running:
-- 1. Export and independently verify a complete D1 backup including entries,
--    SBI valuation, merchant rules, category order, and category icons.
-- 2. Confirm all affected rows have migrated to merchant_rules/category_source.
-- 3. Check schema_migrations has BOTH versions listed below.
-- 4. Test this EXACT SQL on an isolated production-like D1 copy.
-- 5. Explicitly approve deletion of the four historical tables.
-- This script is NOT automatically executed by the application.

-- A CHECK constraint aborts before any DROP if the two migrations were not
-- completed or any old classification/payment/icon/rank has no live counterpart.
-- If any mapping was deliberately removed after migration, this guard may fail:
-- review that difference manually rather than weakening the cleanup guard.
CREATE TABLE _legacy_cleanup_guard_20261029 (ok INTEGER NOT NULL CHECK (ok = 1));

INSERT INTO _legacy_cleanup_guard_20261029(ok)
SELECT CASE WHEN
  (SELECT COUNT(*) FROM schema_migrations WHERE version IN ('unified-merchant-rules-v1','category-source-v1')) = 2
  AND NOT EXISTS (
    SELECT 1 FROM custom_rules old
    LEFT JOIN merchant_rules live ON live.keyword=old.keyword
    WHERE live.category IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM merchant_payment_rules old
    LEFT JOIN merchant_rules live ON live.keyword=old.keyword
    WHERE live.payment_source IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM category_sort_order old
    LEFT JOIN category_source live ON live.category=old.category
    WHERE live.sort_order IS NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM category_icons old
    LEFT JOIN category_source live ON live.category=old.category
    WHERE live.icon IS NULL
  )
THEN 1 ELSE 0 END;

DROP TABLE IF EXISTS custom_rules;
DROP TABLE IF EXISTS merchant_payment_rules;
DROP TABLE IF EXISTS category_sort_order;
DROP TABLE IF EXISTS category_icons;

DROP TABLE _legacy_cleanup_guard_20261029;

-- Verify post-cleanup read-only:
-- SELECT category,sort_order,icon FROM category_source ORDER BY sort_order,category;
-- SELECT keyword,category,payment_source FROM merchant_rules ORDER BY keyword;
-- SELECT version FROM schema_migrations WHERE version IN
--   ('unified-merchant-rules-v1','category-source-v1');
