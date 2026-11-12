-- 0021: distinguish monthly savings, additional fund purchases, and transfers into SBI.
-- Only additive metadata. Existing links default to monthly; unlinked legacy
-- SBI transfers remain monthly in the read API. Points are inferred from the
-- existing reward source and never classified as periodic savings.
-- Apply once to production D1 after taking a Time Travel bookmark.
ALTER TABLE sbi_transfer_links
  ADD COLUMN purpose TEXT NOT NULL DEFAULT 'monthly'
  CHECK(purpose IN ('monthly','purchase','funding'));
