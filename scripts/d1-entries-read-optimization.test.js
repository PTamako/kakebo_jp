import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

test('read-optimization indexes preserve ledger aggregates and enable selective plans',()=>{
 const db=new DatabaseSync(':memory:')
 try{
  db.exec(`CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT NOT NULL,type TEXT NOT NULL,
    payment_source TEXT NOT NULL DEFAULT '',transfer_target TEXT,transfer_date TEXT,
    amount INTEGER NOT NULL,category TEXT NOT NULL,client_request_id TEXT);
    CREATE INDEX idx_entries_date ON entries(date);`)
  const add=db.prepare('INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?)')
  for(let i=1;i<=3600;i++){
   const type=['expense','income','transfer'][i%3]
   const date='2026-11-'+String(1+i%28).padStart(2,'0')
   add.run(i,date,type,i%5===0?'Suica':'cash',type==='transfer'?'prepaid:'+ (i%5===0?'Suica':'other'):null,
     i%7===0?'2026-12-01':null,i%13===0?0:i,'food',i%13===0?'hfcard:test'+i:null)
  }
  const cases=[
   [`SELECT category,SUM(amount) AS amount FROM entries WHERE NOT(amount=0 AND
    (COALESCE(client_request_id,'') LIKE 'hfcard:%' OR COALESCE(client_request_id,'') LIKE 'hfprepaid:%'))
    AND date>=? AND date<? AND type='expense' GROUP BY category ORDER BY amount DESC`,['2026-11-01','2026-12-01'],'idx_entries_type_date'],
   [`SELECT SUM(amount) AS amount FROM entries WHERE type='expense' AND payment_source=?
    AND date BETWEEN ? AND ?`,['Suica','2026-11-01','2026-11-26'],'idx_entries_type_payment_date'],
   [`SELECT SUM(amount) AS amount FROM entries WHERE type='transfer' AND transfer_target=?
    AND date<=? AND COALESCE(transfer_date,date) BETWEEN ? AND ?`,['prepaid:Suica','2026-11-26','2026-11-01','2026-11-26'],'idx_entries_transfer_target_effective_date']
  ]
  const before=cases.map(([sql,args])=>db.prepare(sql).all(...args))
  const sql=readFileSync(new URL('../migrations/0112_entries_read_optimization.sql',import.meta.url),'utf8')
  db.exec(sql);db.exec(sql)
  cases.forEach(([query,args,index],i)=>{
   assert.deepEqual(db.prepare(query).all(...args),before[i])
   const plan=db.prepare('EXPLAIN QUERY PLAN '+query).all(...args).map(x=>x.detail).join(' ')
   assert.ok(plan.includes(index),plan)
  })
  assert.equal(db.prepare('SELECT count(*) n FROM entries').get().n,3600)
 }finally{db.close()}
})
