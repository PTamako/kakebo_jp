import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'

const migration=readFileSync(new URL('../migrations/0006_sbi_portfolio_linkage.sql',import.meta.url),'utf8')
const schema=readFileSync(new URL('../schema.sql',import.meta.url),'utf8')
function oldDatabase(){
  const db=new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE entries(id INTEGER PRIMARY KEY AUTOINCREMENT,date TEXT NOT NULL,type TEXT NOT NULL,amount INTEGER NOT NULL,transfer_target TEXT,transfer_date TEXT,transfer_applied INTEGER DEFAULT 0);
  CREATE TABLE investment_snapshots(platform TEXT PRIMARY KEY,current_value INTEGER,pnl INTEGER,updated_at TEXT);
  INSERT INTO entries(date,type,amount,transfer_target,transfer_date,transfer_applied) VALUES('2026-10-27','transfer',15000,'sbi','2026-11-09',0);
  INSERT INTO investment_snapshots VALUES('sbi',70500,-42,'2026-10-01');`)
  return db
}
const sbiTables=['investment_plans','investment_plan_history','investment_holdings','fund_prices','sbi_transfer_links']
const empty=db=>{
  for(const table of sbiTables)assert.equal(db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n,0,table)
}

test('archived migration creates only schema and preserves the old ledger',()=>{
  const db=oldDatabase()
  try{
    const ledger=db.prepare('SELECT * FROM entries').get()
    const oldValue=db.prepare("SELECT * FROM investment_snapshots WHERE platform='sbi'").get()
    db.exec(migration)
    assert.deepEqual({...db.prepare('SELECT * FROM entries').get()},{...ledger})
    assert.deepEqual({...db.prepare("SELECT * FROM investment_snapshots WHERE platform='sbi'").get()},{...oldValue})
    empty(db)
  }finally{db.close()}
})

test('re-applying archived migration never restores old NISA seed rows',()=>{
  const db=oldDatabase()
  try{
    db.exec(migration)
    db.exec(migration)
    empty(db)
    assert.doesNotMatch(migration,/INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+(?:investment_plans|investment_plan_history|investment_holdings|fund_prices)\b/i)
  }finally{db.close()}
})

test('fresh schema remains compatible without historical portfolio insertion',()=>{
  const db=new DatabaseSync(':memory:')
  try{
    db.exec(schema)
    db.exec(migration)
    empty(db)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='investment_snapshots'").get().n,0)
  }finally{db.close()}
})

test('an existing per-account holding is unchanged on migration replay',()=>{
  const db=oldDatabase()
  try{
    db.exec(migration)
    db.prepare("INSERT INTO investment_holdings(fund_code,account_type,fund_name,units,acquisition_cost) VALUES('03311187','growth','米国株式',9999,44000)").run()
    db.exec(migration)
    const rows=db.prepare("SELECT account_type,units,acquisition_cost FROM investment_holdings WHERE fund_code='03311187'").all()
    assert.equal(rows.length,1)
    assert.deepEqual({...rows[0]},{account_type:'growth',units:9999,acquisition_cost:44000})
  }finally{db.close()}
})
