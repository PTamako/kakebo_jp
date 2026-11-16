import test from 'node:test'
import assert from 'node:assert/strict'
import {verifyLegacyOwner} from '../functions/api/legacy-owner-guard.js'

test('production legacy ledger is fail-closed even when optional owner guard is missing',async()=>{
 const url=new URL('https://kakeibo-f17.pages.dev/api/entries')
 const request=new Request(url,{method:'GET'})
 const prod={APP_ENV:'production',KAKEIBO_FAMILY_FINANCE_ENABLED:'true',
  KAKEIBO_HOMEFLOW_SSO_ENABLED:'true'}
 const response=await verifyLegacyOwner(request,prod,url)
 assert.equal(response?.status,503)
 assert.equal((await response.json()).code,'HOMEFLOW_OWNER_VERIFICATION_UNAVAILABLE')
})

test('production finance is fail-closed if SSO is disabled or misconfigured',async()=>{
 const url=new URL('https://kakeibo-f17.pages.dev/api/payment-sources')
 const response=await verifyLegacyOwner(new Request(url),{
  APP_ENV:'production',KAKEIBO_FAMILY_FINANCE_ENABLED:'true',
  KAKEIBO_HOMEFLOW_SSO_ENABLED:'false'
 },url)
 assert.equal(response?.status,503)
})

test('non-production legacy route without rollout flag preserves explicit opt-in',async()=>{
 const url=new URL('https://unit.example.test/api/payment-sources')
 const response=await verifyLegacyOwner(new Request(url),{
  APP_ENV:'test',KAKEIBO_FAMILY_FINANCE_ENABLED:'true'
 },url)
 assert.equal(response,null)
})

test('forced original-owner proof cannot be bypassed with a legacy cookie',async()=>{
 const url=new URL('https://kakeibo-f17.pages.dev/api/entries')
 const request=new Request(url,{headers:{Cookie:'kakeibo_session='+'a'.repeat(64)}})
 const response=await verifyLegacyOwner(request,{
  APP_ENV:'production',KAKEIBO_FAMILY_FINANCE_ENABLED:'true',
  KAKEIBO_HOMEFLOW_SSO_ENABLED:'true'
 },url)
 assert.equal(response?.status,503)
})
