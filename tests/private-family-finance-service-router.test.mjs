import test from 'node:test';
import assert from 'node:assert/strict';
import bridge from '../workers/homeflow-service-bridge.js';
import {routeInternalFinance} from '../workers/family-finance-service-router.js';

const url=path=>'https://kakeibo.internal'+path;
const request=(path,headers={'content-type':'application/json'},method='POST')=>
 new Request(url(path),{method,headers,body:method==='GET'?undefined:'{}'});
const names=['approved-actions','bank-transfers','card-purchases','card-settlements',
 'points-actions','prepaid-actions','sbi-cash-actions','shared-entries','document-finance'];
test('private Service Binding only permits known backend POST executor/receipt prefixes',async()=>{
 for(const name of names){
  for(const mode of ['execute','receipt']){
   const response=await routeInternalFinance(request('/api/internal/'+name+'/'+mode),{});
   assert.notEqual(response,null,name);
   assert.equal(response.status,503,name+'/'+mode);
   const body=await response.json();
   assert.equal(body.applied,false);
  }
 }
 const recurring=await routeInternalFinance(request('/api/internal/recurring-finance/receipt'),{});
 assert.equal(recurring.status,503);
});
test('private bridge denies cookies, origins, GET, arbitrary actions and sensitive URLs',async()=>{
 for(const [path,headers,method] of [
  ['/api/internal/approved-actions/execute',{'content-type':'application/json',cookie:'sid=attack'},'POST'],
  ['/api/internal/bank-transfers/receipt',{'content-type':'application/json',origin:'https://evil.example'},'POST'],
  ['/api/internal/card-purchases/execute',{'content-type':'application/json',authorization:'Bearer x'},'POST'],
  ['/api/internal/sbi-cash-actions/execute',{'content-type':'application/json'},'GET'],
  ['/api/internal/shared-entries/execute?cash=1',{'content-type':'application/json'},'POST']
 ]){
  const r=await routeInternalFinance(request(path,headers,method),{});
  assert.equal(r.status,403,path);
  assert.equal((await r.json()).applied,false);
 }
 const unknown=await routeInternalFinance(request('/api/internal/future-executor/execute'),{DB:{prepare(){}}});
 assert.equal(unknown.status,404);
 assert.equal(await routeInternalFinance(request('/api/private-owner/export'),{}),null);
 const publicReq=request('/api/internal/approved-actions/execute',{'content-type':'application/json'});
 const routed=await bridge.fetch(publicReq,{});
 assert.equal(routed.status,503);
 const nonsense=await bridge.fetch(request('/api/internal/nonexistent',{ 'content-type':'application/json'}),{});
 assert.equal(nonsense.status,404);
});
test('the legacy HomeFlow projection remains strictly read-only',async()=>{
 const res=await bridge.fetch(request('/api/homeflow-ledger',{},'GET'),{});
 assert.equal(res.status,503);
 const unknown=await bridge.fetch(request('/api/family-finance',{'content-type':'application/json'}),{});
 assert.equal(unknown.status,404);
});
