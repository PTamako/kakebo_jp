import test from 'node:test'
import assert from 'node:assert/strict'
import { validateRegisteredPaymentSource } from '../functions/api/payment-source-validation.js'
const db={prepare(){return {bind(name){return {async first(){
  return name==='Active Card'?{name,is_archived:0}:name==='Archived Card'?{name,is_archived:1}:null
}}}}}}
test('refuses new unknown and archived sources, including direct POST requests',async()=>{
  const missing=await validateRegisteredPaymentSource(db,'Ghost Card')
  assert.equal(missing.code,'payment_source_missing')
  assert.equal(missing.status,400)
  const archived=await validateRegisteredPaymentSource(db,'Archived Card')
  assert.equal(archived.code,'payment_source_archived')
  assert.equal(archived.status,409)
  assert.equal(await validateRegisteredPaymentSource(db,'Active Card'),null)
})
test('allows historical edits and disabled recurring plans without re-enabling archived sources',async()=>{
  assert.equal(await validateRegisteredPaymentSource(db,'Archived Card',{currentSource:'Archived Card'}),null)
  assert.equal(await validateRegisteredPaymentSource(db,'Archived Card',{allowArchived:true}),null)
  assert.equal((await validateRegisteredPaymentSource(db,'Archived Card',{currentSource:'Other'})).code,'payment_source_archived')
})
test('retains explicit cash and unassigned transfer compatibility',async()=>{
  for(const name of ['','現金','その他','其他']){
    assert.equal(await validateRegisteredPaymentSource(db,name),null)
  }
})
