import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import bridge from '../workers/homeflow-service-bridge.js'

const sqls=[]
const db={prepare(sql){sqls.push(sql);return {bind(...args){this.args=args;return this},async all(){return {results:[{
  id:42,date:'2026-11-03',amount:2500,category:'交通',merchant:'駅',type:'expense',
  note:'secret note',raw:'private OCR',payment:'secret'
}]}}}}}
const req=(query,method='GET')=>new Request('https://internal.invalid/api/homeflow-ledger'+query,{method})
test('private worker configuration never exposes a public URL or Preview',()=>{
  const config=readFileSync(new URL('../wrangler.homeflow-bridge.toml',import.meta.url),'utf8')
  assert.match(config,/^workers_dev\s*=\s*false$/m)
  assert.match(config,/^preview_urls\s*=\s*false$/m)
  assert.match(config,/^binding\s*=\s*"DB"$/m)
  assert.doesNotMatch(config,/\[triggers\]|\[\[routes\]\]/)
})
test('bridge has no write endpoint and only exposes six projected fields',async()=>{
  assert.equal((await bridge.fetch(req('','POST'),{DB:db})).status,404)
  const response=await bridge.fetch(req('?ids=42'),{DB:db})
  assert.equal(response.status,200)
  const [entry]=(await response.json()).entries
  assert.deepEqual(Object.keys(entry).sort(),['amount','category','date','id','merchant','type'])
  assert.ok(sqls.every(sql=>/^SELECT\s/i.test(sql)))
})
test('bridge rejects invalid ranges, cursors, and ids before querying D1',async()=>{
  const startCount=sqls.length
  for(const params of [
    '?start=2026-01-01&end=2026-08-01',
    '?ids=0', '?ids=1,0',
    '?start=2026-11-31&end=2026-12-01',
    '?start=2026-11-01&end=2026-11-03&limit=101',
    '?start=2026-11-01&end=2026-11-03&cursor=2026-12-01:42'
  ]){
    assert.equal((await bridge.fetch(req(params),{DB:db})).status,400,params)
  }
  assert.equal(sqls.length,startCount)
})
test('bridge reads at most 51 rows for a 50-row page and supports id lookups',async()=>{
  const response=await bridge.fetch(req('?start=2026-11-01&end=2026-11-04&limit=50'),{DB:db})
  assert.equal(response.status,200)
  assert.ok(sqls.at(-1).includes("WHERE type='expense'"))
})

test('period net uses ONE D1 aggregate and excludes transfers',async()=>{
  const calls=[]
  const source={prepare(sql){
    calls.push(sql)
    return {bind(...args){assert.deepEqual(args,['2026-11-01','2026-11-04']);return this},
      async first(){return {income:10000,expense:4392}}}
  }}
  const response=await bridge.fetch(req('?summary=net&start=2026-11-01&end=2026-11-04'),{DB:source})
  assert.equal(response.status,200)
  assert.deepEqual(await response.json(),{
    start:'2026-11-01',end:'2026-11-04',income:10000,expense:4392,net:5608
  })
  assert.equal(calls.length,1)
  assert.match(calls[0],/type IN \('income','expense'\)/)
  assert.doesNotMatch(calls[0],/type='transfer'/)
})
test('invalid period summaries do not touch D1',async()=>{
  let queries=0
  const db={prepare(){queries++;throw Error('unexpected query')}}
  for(const query of [
    '?summary=net&start=2026-01-01&end=2026-11-31',
    '?summary=net&start=2027-01-01&end=2026-11-01',
    '?summary=net&start=2010-01-01&end=2026-11-04'
  ]){
    const response=await bridge.fetch(req(query),{DB:db})
    assert.equal(response.status,400,query)
  }
  assert.equal(queries,0)
})
