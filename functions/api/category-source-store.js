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
