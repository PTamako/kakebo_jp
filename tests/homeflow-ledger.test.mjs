import test from 'node:test'
import assert from 'node:assert/strict'
import {onRequestGet,onRequest} from '../functions/api/homeflow-ledger.js'
const secret='test-long-random-bridge-secret-000000000001'
const env={HOMEFLOW_LEDGER_READ_TOKEN:secret,DB:{prepare(sql){
  return {bind(...args){this.args=args;return this},async all(){return {results:[{id:42,date:'2026-11-04',amount:2500,merchant:'Demo',category:'交通',type:'expense'}]}}}
}}}
const req=(query='',token=secret)=>new Request('https://example.pages.dev/api/homeflow-ledger'+query,
  {headers:{authorization:'Bearer '+token}})
test('server bridge is disabled without a secret and never accepts another token',async()=>{
  const noSecret=await onRequestGet({request:req(),env:{DB:env.DB}})
  assert.equal(noSecret.status,503)
  const wrong=await onRequestGet({request:req('','another-very-long-bearer-token-00000000'),env})
  assert.equal(wrong.status,401)
  assert.equal((await wrong.json()).error,'not_authorized')
})
test('authenticated projection does not expose OCR, notes, sessions',async()=>{
  const response=await onRequestGet({request:req('?ids=42'),env})
  assert.equal(response.status,200)
  const item=(await response.json()).entries[0]
  assert.deepEqual(Object.keys(item).sort(),['amount','category','date','id','merchant','type'])
})
test('enforce date range, amount of rows and cursor strictness',async()=>{
  for(const query of ['?start=2026-01-01&end=2026-12-01','?ids=1,0','?start=2026-02-30&end=2026-03-01',
    '?start=2026-11-01&end=2026-11-03&limit=999','?start=2026-11-01&end=2026-11-03&cursor=2026-12-01:42']){
    const res=await onRequestGet({request:req(query),env})
    assert.equal(res.status,400,query)
  }
})
test('POST is never supported',async()=>{
  const res=await onRequest({request:new Request('https://example.pages.dev/api/homeflow-ledger',{method:'POST'}),env})
  assert.equal(res.status,405)
})
