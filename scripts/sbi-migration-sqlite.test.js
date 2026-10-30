import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'

const migration=readFileSync(new URL('../migrations/0006_sbi_portfolio_linkage.sql',import.meta.url),'utf8')
const schema=readFileSync(new URL('../schema.sql',import.meta.url),'utf8')
function oldDatabase() {
  const db=new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE entries(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL, type TEXT NOT NULL, amount INTEGER NOT NULL,
    transfer_target TEXT,transfer_date TEXT,transfer_applied INTEGER DEFAULT 0
  );
  CREATE TABLE investment_snapshots(
    platform TEXT PRIMARY KEY,current_value INTEGER,pnl INTEGER,updated_at TEXT
  );
  INSERT INTO entries(date,type,amount,transfer_target,transfer_date,transfer_applied)
    VALUES('2026-10-27','transfer',15000,'sbi','2026-11-09',0);
  INSERT INTO investment_snapshots VALUES('sbi',70500,-42,'2026-10-01');`)
  return db
}

test('additive SBI migration seeds four real holdings without rewriting the old ledger',()=>{
  const db=oldDatabase()
  try{
    const originalEntry=db.prepare('SELECT * FROM entries').get()
    const originalSnapshot=db.prepare("SELECT * FROM investment_snapshots WHERE platform='sbi'").get()
    db.exec(migration)
    assert.deepEqual({...db.prepare('SELECT * FROM entries').get()},{...originalEntry})
    assert.deepEqual({...db.prepare("SELECT * FROM investment_snapshots WHERE platform='sbi'").get()},{...originalSnapshot})
    assert.equal(db.prepare('SELECT count(*) AS n,sum(monthly_amount) AS total FROM investment_plans').get().total,15000)
    assert.equal(db.prepare('SELECT count(*) AS n FROM investment_plans').get().n,4)
    assert.deepEqual({...db.prepare('SELECT COUNT(*) n,SUM(units) units,SUM(acquisition_cost) cost,SUM(reported_value) value FROM investment_holdings').get()},
      {n:4,units:20020,cost:71439,value:71560})
    assert.equal(db.prepare("SELECT COUNT(*) n FROM investment_holdings WHERE account_type='combined'").get().n,3)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM fund_prices').get().n,4)
  }finally{db.close()}
})

test('migration is idempotent and does not overwrite edited holdings or allocations',()=>{
  const db=oldDatabase()
  try{
    db.exec(migration)
    db.prepare("UPDATE investment_holdings SET units=9999,acquisition_cost=50000,reported_value=NULL WHERE fund_code='03311187'").run()
    db.prepare("UPDATE investment_plans SET monthly_amount=7000 WHERE fund_code='04317188'").run()
    db.prepare("INSERT INTO investment_plan_history(fund_code,account_type,effective_month,fund_name,monthly_amount,order_day) VALUES('04317188','tsumitate','2026-11','NASDAQ100',7000,9)").run()
    db.prepare("INSERT INTO investment_plans(fund_code,account_type,fund_name,monthly_amount,order_day) VALUES('ABCDE123','growth','新しい投資信託',1000,9)").run()
    db.exec(migration)
    assert.equal(db.prepare("SELECT units FROM investment_holdings WHERE fund_code='03311187'").get().units,9999)
    assert.equal(db.prepare("SELECT monthly_amount FROM investment_plans WHERE fund_code='04317188'").get().monthly_amount,7000)
    assert.equal(db.prepare("SELECT monthly_amount FROM investment_plan_history WHERE fund_code='04317188' AND effective_month='2026-11'").get().monthly_amount,7000)
    assert.equal(db.prepare("SELECT COUNT(*) n FROM investment_plan_history WHERE effective_month='2026-10'").get().n,4,'do not back-fill newly added funds into the original period')
    assert.equal(db.prepare("SELECT COUNT(*) n FROM investment_plan_history WHERE fund_code='ABCDE123'").get().n,0)
    assert.equal(db.prepare("SELECT COUNT(*) n FROM investment_holdings").get().n,4)
  }finally{db.close()}
})

test('full fresh schema is compatible with the explicit one-time SBI migration',()=>{
  const db=new DatabaseSync(':memory:')
  try{
    db.exec(schema)
    db.exec(migration)
    assert.equal(db.prepare('SELECT COUNT(*) n FROM investment_holdings').get().n,4)
    assert.equal(db.prepare('SELECT SUM(monthly_amount) n FROM investment_plan_history').get().n,15000)
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name='investment_snapshots'").get().n,0)
  }finally{db.close()}
})

test('existing per-account holding prevents adding an overlapping combined screenshot row',()=>{
  const db=oldDatabase()
  try{
    // Simulate a partial migration where a user already entered a real
    // account-level position. New initialization must never double-count it.
    db.exec(schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS investment_plans (')))
    db.prepare(`INSERT INTO investment_holdings(fund_code,account_type,fund_name,units,acquisition_cost)
      VALUES('03311187','growth','米国株式（既存）',9999,44000)`).run()
    db.exec(migration)
    const positions=db.prepare("SELECT account_type,units,acquisition_cost FROM investment_holdings WHERE fund_code='03311187'").all()
    assert.equal(positions.length,1)
    assert.deepEqual({...positions[0]},{account_type:'growth',units:9999,acquisition_cost:44000})
  }finally{db.close()}
})
