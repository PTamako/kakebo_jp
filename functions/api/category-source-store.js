// D1 stores category display names and icon IDs; SVG artwork stays in the client bundle.
const CATEGORY_METADATA = [
  [
    "餐饮",
    "外食",
    "dining"
  ],
  [
    "饮食料品",
    "飲食料品",
    "food"
  ],
  [
    "日用品",
    "日用品",
    "daily"
  ],
  [
    "交通",
    "交通費",
    "transport"
  ],
  [
    "购物",
    "買い物",
    "shopping"
  ],
  [
    "居住",
    "住居費",
    "home"
  ],
  [
    "医疗",
    "医療費",
    "medical"
  ],
  [
    "娱乐",
    "娯楽",
    "entertainment"
  ],
  [
    "宠物",
    "ペット",
    "pet"
  ],
  [
    "其他",
    "その他",
    "other"
  ],
  [
    "工资",
    "給与",
    "salary"
  ],
  [
    "奖金",
    "賞与",
    "bonus"
  ],
  [
    "副业",
    "副業",
    "sidejob"
  ],
  [
    "老公生活费",
    "配偶者からの生活費",
    "home"
  ],
  [
    "父母赠与",
    "親からの贈与",
    "family-gift"
  ],
  [
    "亲友赠与",
    "親族・友人からの贈与",
    "family-gift"
  ],
  [
    "退款",
    "返金",
    "refund"
  ],
  [
    "其他收入",
    "その他の収入",
    "other"
  ],
  [
    "投資・資産移動",
    "資産移動",
    "transfer"
  ]
]

async function ensureCategoryPresentation(db) {
  const columns = await db.prepare('PRAGMA table_info(category_source)').all()
  if (!(columns.results || []).some(c => c.name === 'display_name')) {
    try { await db.prepare('ALTER TABLE category_source ADD COLUMN display_name TEXT').run() }
    catch (error) { if (!/duplicate column name/i.test(String(error))) throw error }
  }
  const version = 'category-presentation-v1'
  if (await db.prepare('SELECT version FROM schema_migrations WHERE version=?1').bind(version).first()) return
  const updates = CATEGORY_METADATA.map(([category,displayName,icon]) =>
    db.prepare(`INSERT INTO category_source(category,display_name,icon) VALUES(?1,?2,?3)
      ON CONFLICT(category) DO UPDATE SET display_name=COALESCE(category_source.display_name,excluded.display_name),
      icon=COALESCE(category_source.icon,excluded.icon)`).bind(category,displayName,icon))
  updates.push(db.prepare('INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(?1,?2)')
    .bind(version,'Initialize Japanese names and default category icon IDs'))
  await db.batch(updates)
}

// Single active source of category sorting and icons.
// This copies legacy columns once, transactionally, and never drops their tables.
// An operator may remove old tables only after a real D1 backup and read-only reconciliation.
const STANDARD_RANKS = [
  ['餐饮',0],['饮食料品',1],['日用品',2],['交通',3],['购物',4],
  ['居住',5],['医疗',6],['娱乐',7],['宠物',8],
  ['其他',99999],['其他收入',99999]
]

export async function ensureCategorySource(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS category_source (
    category TEXT PRIMARY KEY,
    sort_order INTEGER,
    icon TEXT,
    display_name TEXT
  )`).run()
  await db.prepare("CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, description TEXT NOT NULL)").run()
  const version='category-source-v1'
  if (await db.prepare('SELECT version FROM schema_migrations WHERE version=?1').bind(version).first()) {
    await ensureCategoryPresentation(db)
    return
  }
  const {results}=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('category_sort_order','category_icons')").all()
  const legacy=new Set((results||[]).map(row=>row.name))
  const pending=[]
  const notDone="NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version='category-source-v1')"
  if (legacy.has('category_sort_order')) {
    pending.push(db.prepare(`INSERT INTO category_source(category,sort_order)
      SELECT category,sort_order FROM category_sort_order WHERE ${notDone}
      ON CONFLICT(category) DO UPDATE SET sort_order=COALESCE(category_source.sort_order,excluded.sort_order)`))
  }
  if (legacy.has('category_icons')) {
    pending.push(db.prepare(`INSERT INTO category_source(category,icon)
      SELECT category,icon FROM category_icons WHERE ${notDone}
      ON CONFLICT(category) DO UPDATE SET icon=COALESCE(category_source.icon,excluded.icon)`))
  }
  for (const [category,rank] of STANDARD_RANKS) {
    pending.push(db.prepare(`INSERT INTO category_source(category,sort_order) VALUES(?1,?2)
      ON CONFLICT(category) DO UPDATE SET
        sort_order=CASE WHEN excluded.sort_order=99999 THEN 99999
          ELSE COALESCE(category_source.sort_order,excluded.sort_order) END`).bind(category,rank))
  }
  pending.push(db.prepare("INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(?1,?2)")
    .bind(version,'Merge category_sort_order and category_icons without deleting historical tables'))
  await db.batch(pending)
  await ensureCategoryPresentation(db)
}
