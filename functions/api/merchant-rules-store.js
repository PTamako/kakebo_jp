// One live mapping per keyword. Category and payment-source preferences are
// independent and may coexist. Legacy tables are retained read-only as a
// rollback snapshot; they are never dropped or overwritten.
export async function ensureUnifiedMerchantRules(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS merchant_rules (
    keyword TEXT PRIMARY KEY,
    category TEXT,
    payment_source TEXT,
    CHECK (category IS NOT NULL OR payment_source IS NOT NULL)
  )`).run()
  await db.prepare("CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, description TEXT NOT NULL)").run()
  const version = 'unified-merchant-rules-v1'
  const migrated = await db.prepare('SELECT version FROM schema_migrations WHERE version=?1').bind(version).first()
  if (migrated) return
  const { results: tables } = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('custom_rules','merchant_payment_rules')").all()
  const names = new Set((tables || []).map(x => x.name))
  const pending = []
  const notDone = "NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version='unified-merchant-rules-v1')"
  if (names.has('custom_rules')) {
    pending.push(db.prepare(`INSERT OR IGNORE INTO merchant_rules(keyword,category)
      SELECT keyword,category FROM custom_rules WHERE ${notDone}`))
  }
  if (names.has('merchant_payment_rules')) {
    pending.push(db.prepare(`INSERT INTO merchant_rules(keyword,payment_source)
      SELECT keyword,payment_source FROM merchant_payment_rules WHERE ${notDone}
      ON CONFLICT(keyword) DO UPDATE SET payment_source=excluded.payment_source`))
  }
  pending.push(db.prepare("INSERT OR IGNORE INTO schema_migrations(version,description) VALUES(?1,?2)")
    .bind(version,'Copy legacy custom and payment rules into unified merchant_rules; originals retained'))
  // D1 batch is a transaction. A failed copy cannot set the completion marker.
  await db.batch(pending)
}
