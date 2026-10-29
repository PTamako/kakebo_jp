-- Additive, idempotent sort metadata. Does not modify saved transactions.
-- 99999 is reserved for the user-facing その他 (Other) options.
CREATE TABLE IF NOT EXISTS category_sort_order (
  category TEXT PRIMARY KEY,
  sort_order INTEGER NOT NULL
);

INSERT OR IGNORE INTO category_sort_order(category,sort_order) VALUES
('餐饮',0),('饮食料品',1),('日用品',2),('交通',3),('购物',4),
('居住',5),('医疗',6),('娱乐',7),('宠物',8);

-- Preserve existing custom category names, rules and icons.
INSERT OR IGNORE INTO category_sort_order(category,sort_order)
SELECT category, 8 + ROW_NUMBER() OVER (ORDER BY category)
FROM (
  SELECT DISTINCT category FROM rules
  WHERE substr(keyword,1,13)='__category__:' AND category NOT IN ('其他','其他收入')
);

INSERT INTO category_sort_order(category,sort_order)
VALUES('其他',99999),('其他收入',99999)
ON CONFLICT(category) DO UPDATE SET sort_order=99999;

-- Existing card ordering remains unchanged, except that その他 goes last.
UPDATE payment_sources
SET sort_order=99999
WHERE name IN ('その他','其他') AND sort_order<>99999;
