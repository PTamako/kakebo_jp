import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { handlePrepaid } from '../functions/api/prepaid-assets.js'
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')
const dateOffset = n => new Date(Date.now()+9*3600000+n*86400000).toISOString().slice(0,10)
function createDB() {
  const sqlite=new DatabaseSync(':memory:')
  sqlite.exec(read('schema.sql'))
  const db={
    prepare(sql){const statement=sqlite.prepare(sql);return {
      args:[],
      bind(...args){this.args=args;return this},
      async first(){return statement.get(...this.args)||null},
      async all(){return {results:statement.all(...this.args)}},
      async run(){const r=statement.run(...this.args);return {meta:{changes:r.changes}}}
    }},
    sqlite
  }
  const addCard=sqlite.prepare("INSERT INTO payment_sources(name,sort_order,source_type,opening_balance,opening_date,opening_entry_id) VALUES(?1,?2,'prepaid',?3,?4,?5)")
  const addEntry=sqlite.prepare("INSERT INTO entries(date,time,type,amount,payment_source,transfer_target,transfer_date,merchant) VALUES(?1,?2,?3,?4,?5,?6,?7,?8)")
  const add=(date,time,type,amount,payment='',target=null,transferDate=null,merchant='')=>Number(addEntry.run(date,time,type,amount,payment,target,transferDate,merchant).lastInsertRowid)
  return {db,sqlite,addCard,add}
}
async function get(db) {
  const response=await handlePrepaid({db,request:new Request('https://example.test/api/prepaid-assets'),method:'GET',sub:''})
  assert.equal(response.status,200)
  return response.json()
}

test('latest usage and recharge match posted prepaid balance across cards, not the card funding payment',async()=>{
  const {db,sqlite,addCard,add}=createDB()
  try {
    const today=dateOffset(0),yesterday=dateOffset(-1),old=dateOffset(-8),opened=dateOffset(-7),future=dateOffset(2)
    // These historic IDs must be ignored even if their dates are later than opening date.
    add(today,'10:00','expense',999,'Suica')
    const anchor=add(old,'09:00','transfer',800,'現金','prepaid:Suica',old)
    addCard.run('Suica',0,120,opened,anchor)
    addCard.run('PASMO',1,200,opened,anchor)
    addCard.run('new wallet',2,0,opened,anchor)
    add(today,'11:00','expense',990,'三井住友カード',null,null,'対象外')
    add(today,'11:00','transfer',15000,'セゾンカード','sbi',today)
    add(today,'11:00','income',2000,'PASMO')
    add(today,'09:00','expense',310,'Suica',null,null,'コンビニ')
    add(today,'13:30','expense',450,'PASMO',null,null,'カフェ')
    add(future,'22:00','expense',5000,'PASMO',null,null,'未来')
    add(yesterday,'10:00','transfer',2000,'現金','prepaid:PASMO',yesterday)
    add(yesterday,'08:00','transfer',1200,'セゾンカード','prepaid:Suica',today)
    add(today,'17:00','transfer',3000,'三井住友カード','prepaid:Suica',future) // unposted
    add(future,'08:00','transfer',7000,'現金','prepaid:PASMO',today) // future entry
    const result=await get(db)
    assert.equal(result.cards.length,3)
    assert.equal(result.cards.find(x=>x.name==='Suica').balance,120+1200-310)
    assert.equal(result.cards.find(x=>x.name==='PASMO').balance,200+2000-450)
    assert.equal(result.latestUsage.card,'PASMO')
    assert.equal(result.latestUsage.amount,450)
    assert.equal(result.latestUsage.merchant,'カフェ')
    assert.equal(result.latestUsage.date,today)
    assert.equal(result.latestCharge.card,'Suica')
    assert.equal(result.latestCharge.amount,1200)
    assert.equal(result.latestCharge.funding_source,'セゾンカード')
    assert.equal(result.latestCharge.date,today)
  } finally {sqlite.close()}
})
test('when there are no eligible posted entries, latest items are null (never guess)',async()=>{
  const {db,sqlite,addCard,add}=createDB()
  try {
    const today=dateOffset(0)
    addCard.run('独自カード',0,900,today,0)
    const initial=await get(db)
    assert.equal(initial.latestUsage,null)
    assert.equal(initial.latestCharge,null)
    add(dateOffset(1),'09:00','transfer',1000,'現金','prepaid:独自カード',dateOffset(1))
    add(dateOffset(1),'10:00','expense',100,'独自カード')
    const later=await get(db)
    assert.equal(later.latestUsage,null)
    assert.equal(later.latestCharge,null)
    assert.equal(later.cards[0].balance,900)
  } finally {sqlite.close()}
})
test('wallet tile displays last usage/card/amount and last top-up/card/funding without adding screens or stored state',()=>{
  const api=read('functions/api/prepaid-assets.js')
  const prepaid=read('src/PrepaidAssets.vue')
  const page=read('src/pages/AssetsPage.vue')
  assert.match(api,/e.type='expense' AND e.id>p.opening_entry_id/)
  assert.match(api,/e.type='transfer' AND e.id>p.opening_entry_id/)
  assert.match(api,/COALESCE\(e.transfer_date,e.date\)<=\?1/)
  assert.match(api,/latestUsage:latestUsage \|\| null/)
  assert.match(api,/latestCharge:latestCharge \|\| null/)
  assert.match(prepaid,/latestUsage:payload.latestUsage \|\| null/)
  assert.match(prepaid,/latestCharge:payload.latestCharge \|\| null/)
  assert.match(page,/最近の|↘ 利用/)
  assert.match(page,/↗ 最近のチャージ/)
  assert.match(page,/latestUsage\.card/)
  assert.match(page,/latestCharge\.card/)
  assert.match(page,/latestCharge\.funding_source/)
  assert.match(page,/prepaidSummary \? '記録なし' : '—'/)
  assert.doesNotMatch(api,/INSERT INTO entries|UPDATE entries|CREATE TABLE|DROP TABLE/)
  assert.doesNotMatch(page,/assetsTotal|資産合計/)
})

test('wallet-to-wallet transfers and SBI funding debit the prepaid source exactly once',async()=>{
  const {db,sqlite,addCard,add}=createDB()
  try{
    const day=dateOffset(0),future=dateOffset(2),old=dateOffset(-2)
    addCard.run('Suica',0,5000,old,0)
    addCard.run('PASMO',1,2000,old,0)
    add(day,'09:00','transfer',1000,'Suica','prepaid:PASMO',day)
    add(day,'10:00','transfer',500,'Suica','sbi',day)
    add(day,'11:00','transfer',200,'Suica','prepaid:PASMO',future)
    add(day,'12:00','expense',300,'Suica')
    const result=await get(db)
    const suica=result.cards.find(c=>c.name==='Suica'),pasmo=result.cards.find(c=>c.name==='PASMO')
    assert.equal(suica.charged,0)
    assert.equal(suica.spent,300)
    assert.equal(suica.transferred_out,1500)
    assert.equal(suica.balance,3200)
    assert.equal(pasmo.charged,1000)
    assert.equal(pasmo.balance,3000)
    assert.equal(result.cards.reduce((sum,c)=>sum+c.balance,0),6200)
  }finally{sqlite.close()}
})
