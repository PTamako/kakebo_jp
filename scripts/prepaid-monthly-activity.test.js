import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { handlePrepaid } from '../functions/api/prepaid-assets.js'
import { matchesPrepaidHistoryEntry } from '../src/prepaid-history.js'

const dayInJST = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
const previousMonthEnd = today => {
  const [y,m] = today.slice(0,7).split('-').map(Number)
  return new Date(Date.UTC(y,m - 1,0)).toISOString().slice(0,10)
}
const followingMonthStart = today => {
  const [y,m] = today.slice(0,7).split('-').map(Number)
  return new Date(Date.UTC(y,m,1)).toISOString().slice(0,10)
}

test('wallet shows month-to-date activity, but calculates balance from full posted history', async () => {
  const sqlite = new DatabaseSync(':memory:')
  try {
    sqlite.exec('CREATE TABLE payment_sources (name TEXT PRIMARY KEY, source_type TEXT, opening_balance INTEGER, opening_date TEXT, opening_entry_id INTEGER, sort_order INTEGER); CREATE TABLE entries (id INTEGER PRIMARY KEY, type TEXT, payment_source TEXT, transfer_target TEXT, date TEXT, transfer_date TEXT, amount INTEGER, time TEXT, merchant TEXT);')
    const today=dayInJST(), previous=previousMonthEnd(today), upcoming=followingMonthStart(today)
    sqlite.prepare("INSERT INTO payment_sources VALUES (?,?,?,?,?,?)")
      .run('Suica','prepaid',1000,previous,0,0)
    sqlite.prepare("INSERT INTO payment_sources VALUES (?,?,?,?,?,?)")
      .run('PASMO','prepaid',0,previous,0,1)
    const insert=sqlite.prepare('INSERT INTO entries (id,type,payment_source,transfer_target,date,transfer_date,amount,time,merchant) VALUES (?,?,?,?,?,?,?,?,?)')
    insert.run(1,'transfer','現金','prepaid:Suica',previous,previous,10000,'12:00','前月チャージ')
    insert.run(2,'expense','Suica',null,previous,null,8000,'13:00','前月利用')
    insert.run(3,'transfer','現金','prepaid:Suica',today,today,5000,'09:00','今月チャージ')
    insert.run(4,'expense','Suica',null,today,null,700,'10:00','今月利用')
    insert.run(5,'transfer','Suica','sbi',today,today,300,'11:00','今月振替')
    insert.run(6,'transfer','現金','prepaid:Suica',previous,today,2000,'08:00','前月記帳・今月反映')
    insert.run(7,'transfer','現金','prepaid:Suica',today,upcoming,9000,'17:00','未来のチャージ')
    insert.run(8,'expense','Suica',null,upcoming,null,2000,'09:00','未来の利用')
    const db={
      prepare(sql){
        const stmt=sqlite.prepare(sql)
        return {
          all:async()=>({results:stmt.all()}),
          first:async()=>stmt.get(),
          bind(...values){
            return {
              all:async()=>({results:stmt.all(...values)}),
              first:async()=>stmt.get(...values)
            }
          }
        }
      }
    }
    const response=await handlePrepaid({db,request:new Request('https://example.test/prepaid-assets'),method:'GET',sub:''})
    assert.equal(response.status,200)
    const payload=await response.json()
    const suica=payload.cards.find(card=>card.name==='Suica')
    assert.ok(suica)
    assert.equal(Number(suica.charged),17000)
    assert.equal(Number(suica.spent),8700)
    assert.equal(Number(suica.transferred_out),300)
    assert.equal(Number(suica.balance),9000)
    assert.equal(Number(suica.charged_month),7000)
    assert.equal(Number(suica.spent_month),700)
    assert.equal(Number(suica.transferred_out_month),300)
    const pasmo=payload.cards.find(card=>card.name==='PASMO')
    assert.equal(Number(pasmo.balance),0)
    assert.equal(Number(pasmo.charged_month),0)
    assert.equal(Number(pasmo.spent_month),0)
    assert.equal(payload.latestCharge.merchant,undefined)
  } finally {
    sqlite.close()
  }
})

test('wallet history links filter by wallet and movement type; never return future movements', () => {
  const today=dayInJST(), previous=previousMonthEnd(today), upcoming=followingMonthStart(today)
  const base={date:today,id:10,amount:1000}
  const charge={...base,type:'transfer',payment_source:'現金',transfer_target:'prepaid:Suica',transfer_date:today}
  const spend={...base,type:'expense',payment_source:'Suica'}
  const outgoing={...base,type:'transfer',payment_source:'Suica',transfer_target:'sbi',transfer_date:today}
  const chargeFilter={card:'Suica',kind:'charge',openingDate:previous,openingEntryId:0}
  const usageFilter={...chargeFilter,kind:'usage'}
  assert.equal(matchesPrepaidHistoryEntry(charge,chargeFilter,today),true)
  assert.equal(matchesPrepaidHistoryEntry(charge,usageFilter,today),false)
  assert.equal(matchesPrepaidHistoryEntry(spend,usageFilter,today),true)
  assert.equal(matchesPrepaidHistoryEntry(outgoing,usageFilter,today),true)
  assert.equal(matchesPrepaidHistoryEntry({...charge,transfer_date:upcoming},chargeFilter,today),false)
  assert.equal(matchesPrepaidHistoryEntry({...spend,payment_source:'PASMO'},usageFilter,today),false)
  assert.equal(matchesPrepaidHistoryEntry({...charge,id:0},chargeFilter,today),false)
})

test('compact wallet cards use only monthly flow metrics, not lifetime totals', () => {
  const component=readFileSync(new URL('../src/PrepaidAssets.vue',import.meta.url),'utf8')
  assert.match(component,/今月のチャージ/)
  assert.match(component,/今月の利用/)
  assert.match(component,/card\.charged_month/)
  assert.match(component,/card\.spent_month/)
  assert.match(component,/card\.transferred_out_month/)
  assert.doesNotMatch(component,/チャージ累計|利用累計/)
})
