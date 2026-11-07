import test from 'node:test'
import assert from 'node:assert/strict'
import {onRequestGet,onRequest} from '../functions/api/homeflow-ledger.js'
test('public HomeFlow ledger route is permanently retired even with a valid token',async()=>{
  let reads=0
  const env={HOMEFLOW_LEDGER_READ_TOKEN:'a'.repeat(40),DB:{prepare(){reads++;throw Error('D1 should not be read')}}}
  for(const [method,path] of [['GET','?ids=42'],['GET','?start=2026-11-01&end=2026-11-07'],['POST','']]){
    const request=new Request('https://kakeibo-f17.pages.dev/api/homeflow-ledger'+path,
      {method,headers:{authorization:'Bearer '+'a'.repeat(40)}})
    const response=await onRequest({request,env})
    assert.equal(response.status,410)
    assert.equal((await response.json()).error,'public_bridge_retired')
  }
  assert.equal((await onRequestGet({request:new Request('https://branch.kakeibo-f17.pages.dev/api/homeflow-ledger'),env})).status,410)
  assert.equal(reads,0)
})
