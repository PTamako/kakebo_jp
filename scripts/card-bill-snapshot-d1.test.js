import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { getCardBillSnapshots } from '../functions/api/card-bill-snapshots.js'
function setup(){
  const sqlite=new DatabaseSync(':memory:')
  sqlite.exec(`CREATE TABLE card_bills(payment_source TEXT,bill_month TEXT,period_start TEXT,period_end TEXT,total_amount INTEGER,transaction_count INTEGER);
    CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,type TEXT,amount INTEGER,payment_source TEXT,transfer_target TEXT,category TEXT);`)
  const db={prepare(sql){return {async all(){return {results:sqlite.prepare(sql).all()}}}}}
  return {sqlite,db}
}
test('saved bills are compared against current D1 records without changing snapshots',async()=>{
  const {sqlite,db}=setup()
  sqlite.exec(`INSERT INTO card_bills VALUES ('Card A','2026-11','2026-10-11','2026-11-10',1000,1);
    INSERT INTO entries VALUES (1,'2026-10-20','expense',1000,'Card A',NULL,'日用品');`)
  let row=(await getCardBillSnapshots(db))[0]
  assert.equal(row.stale,false)
  sqlite.exec(`INSERT INTO entries VALUES (2,'2026-11-01','income',150,'Card A','credit:Card A','ポイント還元');`)
  row=(await getCardBillSnapshots(db))[0]
  assert.equal(row.total,1000)
  assert.equal(row.currentTotal,850)
  assert.equal(row.currentCount,2)
  assert.equal(row.stale,true)
  assert.equal(sqlite.prepare('SELECT total_amount FROM card_bills').get().total_amount,1000)
  sqlite.close()
})
test('transfers count toward card usage, while unrelated income does not',async()=>{
  const {sqlite,db}=setup()
  sqlite.exec(`INSERT INTO card_bills VALUES('Card A','2026-11','2026-10-11','2026-11-10',0,0);
    INSERT INTO entries VALUES (1,'2026-11-01','transfer',500,'Card A','prepaid:nanaco','投資・資産移動');
    INSERT INTO entries VALUES (2,'2026-11-02','income',200,'Card A',NULL,'給与');`)
  const row=(await getCardBillSnapshots(db))[0]
  assert.equal(row.currentTotal,500)
  assert.equal(row.currentCount,1)
  assert.equal(row.stale,true)
  sqlite.close()
})
