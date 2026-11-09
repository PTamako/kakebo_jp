import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {validateCardBillRecalculation} from '../functions/api/card-bill-validation.js'
import {readFileSync} from 'node:fs'

const valid=(name='楽天カード')=>({name,month:'2026-11',start:'2026-10-11',end:'2026-11-10'})
const sqlite=new DatabaseSync(':memory:')
sqlite.exec(`CREATE TABLE payment_sources(name TEXT PRIMARY KEY,source_type TEXT,is_archived INTEGER,closing_day INTEGER,stat_group TEXT);
INSERT INTO payment_sources VALUES('楽天カード','standard',0,10,'card');
INSERT INTO payment_sources VALUES('月末カード','standard',0,0,'card');
INSERT INTO payment_sources VALUES('旧カード','standard',1,10,'card');
INSERT INTO payment_sources VALUES('Suica','prepaid',0,NULL,'card');
INSERT INTO payment_sources VALUES('ポイント','standard',0,10,'points');`)
const db={prepare(sql){return {bind(...args){return {async first(){return sqlite.prepare(sql).get(...args)}}}}}}
test('both bill write endpoints use the same server validator',()=>{
  const api=readFileSync(new URL('../functions/api/[[path]].js',import.meta.url),'utf8')
  assert.equal(api.match(/validateCardBillRecalculation\(db,item\)/g)?.length,2)
})
test('canonical Japanese closing periods are accepted for registered cards',async()=>{
  assert.equal(await validateCardBillRecalculation(db,valid()),null)
  assert.equal(await validateCardBillRecalculation(db,{name:'月末カード',month:'2026-11',start:'2026-11-01',end:'2026-11-30'}),null)
  assert.equal(await validateCardBillRecalculation(db,{name:'月末カード',month:'2026-02',start:'2026-02-01',end:'2026-02-28'}),null)
})
test('recalculate cannot write unrelated/prepaid/archived/point-source statements',async()=>{
  for(const name of ['現金','不明','旧カード','Suica','ポイント']){
    assert.equal((await validateCardBillRecalculation(db,valid(name))).code,'invalid_card_bill_period')
  }
})
test('invalid and forged billing windows are rejected, including malicious long ranges',async()=>{
  for(const value of [
    {...valid(),end:'2026-12-10'}, {...valid(),start:'2026-01-01'},
    {...valid(),start:'2026-10-12'}, {...valid(),end:'2026-11-11'},
    {...valid(),month:'2026-13'}, {...valid(),start:'2026-02-30'},
    {...valid(),name:' 楽天カード'}, {...valid(),name:[]}, null
  ])assert.equal((await validateCardBillRecalculation(db,value)).code,'invalid_card_bill_period')
})
test.after(()=>sqlite.close())
