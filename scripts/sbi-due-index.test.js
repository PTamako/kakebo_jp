import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { applyDueSbiTransfers } from '../functions/api/investment-transfer.js'

function fixture() {
  const sqlite=new DatabaseSync(':memory:')
  sqlite.exec(`
    CREATE TABLE entries(
      id INTEGER PRIMARY KEY,date TEXT NOT NULL,type TEXT NOT NULL,
      transfer_target TEXT,transfer_date TEXT,transfer_applied INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE schema_migrations(
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      description TEXT NOT NULL
    );
  `)
  const migration=readFileSync(new URL('../migrations/0015_sbi_due_transfer_index.sql',import.meta.url),'utf8')
  sqlite.exec(migration)
  sqlite.exec(migration) // idempotent; never duplicate the marker
  const adapter={prepare(sql){return {bind(...params){return {
    async run(){
      const statement=sqlite.prepare(sql.replace(/\\?\\d+/g,'?'))
      const result=statement.run(...params)
      return {meta:{changes:Number(result.changes)}}
    }
  }}}}}
  return {sqlite,adapter}
}

test('0015 migration is additive, repeatable and tracked exactly once',()=>{
  const {sqlite}=fixture()
  const versions=sqlite.prepare("SELECT count(*) AS n FROM schema_migrations WHERE version='schema-0015-verified'").get()
  assert.equal(versions.n,1)
  const indexes=sqlite.prepare("PRAGMA index_list('entries')").all()
  assert.equal(indexes.filter(x=>x.name==='idx_entries_sbi_due_unapplied').length,1)
})

test('outstanding SBI UPDATE uses the selective partial expression index',()=>{
  const {sqlite}=fixture()
  const plan=sqlite.prepare(`EXPLAIN QUERY PLAN UPDATE entries SET transfer_applied = 1
    WHERE type='transfer' AND transfer_target='sbi' AND transfer_applied = 0
      AND COALESCE(transfer_date,date) <= '2026-11-03'`).all()
  assert.ok(plan.some(row=>String(row.detail).includes('idx_entries_sbi_due_unapplied')),
    'SQLite should use the partial expression index, not scan all historical entries')
})

test('indexed SBI settlement is due-date safe and repeatable',async()=>{
  const {sqlite,adapter}=fixture()
  const add=sqlite.prepare('INSERT INTO entries(date,type,transfer_target,transfer_date,transfer_applied) VALUES(?,?,?,?,?)')
  add.run('2026-11-01','transfer','sbi','2026-11-02',0)
  add.run('2026-11-01','transfer','sbi','2026-11-20',0)
  add.run('2026-11-01','transfer','prepaid:Suica',null,0)
  add.run('2026-11-01','transfer','sbi',null,0)
  add.run('2026-11-01','transfer','sbi','2026-11-02',1)
  assert.equal((await applyDueSbiTransfers(adapter,'2026-11-03')).applied,2)
  assert.equal((await applyDueSbiTransfers(adapter,'2026-11-03')).applied,0)
  assert.deepEqual(sqlite.prepare('SELECT transfer_applied FROM entries ORDER BY id').all().map(x=>x.transfer_applied),[1,0,0,1,1])
})
