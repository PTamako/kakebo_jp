import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const api=readFileSync(new URL('../functions/api/family-finance/[[path]].js',import.meta.url),'utf8');
const projection=readFileSync(new URL('../functions/api/family-finance/personal-assets.js',import.meta.url),'utf8');
const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8');
const workspace=readFileSync(new URL('../src/FamilyMemberWorkspace.vue',import.meta.url),'utf8');
const identity=readFileSync(new URL('../src/FamilyFinanceAccess.vue',import.meta.url),'utf8');

test('authenticated personal accounts cannot return another HomeFlow member accounts',()=>{
 assert.match(api,/WHERE household_id=\? AND owner_user_id=\? ORDER BY is_archived/);
 assert.match(api,/user\.household_id,user\.user_id\)/);
 assert.match(api,/account_scope:'personal'/);
 assert.match(api,/WHERE account_id=\? AND household_id=\?/);
 assert.match(api,/if\(account\.owner_user_id!==user\.user_id\)/);
});
test('no member route can return the original owner\'s prepaid cards and SBI snapshot',()=>{
 assert.match(api,/user\.role!=='owner'\)return json\(\{code:'PRIVATE_ASSET_SCOPE_REQUIRED'\},403\)/);
 assert.match(api,/parts\[0\]==='personal'&&parts\[1\]==='assets'/);
 assert.match(api,/return familyPersonalAssets\(env,user\)/);
 assert.match(projection,/WHERE household_id=\? AND owner_user_id=\?/);
 assert.match(projection,/\.bind\(user\.household_id,user\.user_id\)/);
 assert.match(projection,/own\.has\(a\.account_id\)&&\s*a\.owner_user_id===user\.user_id/);
 assert.doesNotMatch(projection,/handlePrepaid|handlePortfolio|handleR2Receipts/);
 assert.match(api,/private_payment_sources_redacted:user\.role!=='owner'/);
 assert.match(api,/payment_sources:user\.role==='owner'\?paymentSources:\[\]/);
});
test('HomeFlow member bypasses old legacy access even with an old device session',()=>{
 assert.match(app,/const member=await fetch\('\/api\/homeflow-sso\/me'/);
 assert.match(app,/proof\.identity\?\.role==='member'/);
 assert.match(app,/onFamilyIdentityChange\(proof\.identity\);locked\.value=true;return true/);
 assert.match(app,/if\(familyIdentity\.value\?\.role==='member'\)return flash/);
 assert.match(app,/<FamilyMemberWorkspace v-if="familyIdentity\?\.role==='member'"/);
 assert.match(identity,/emit\('identity-change',user\.identity\)/);
 assert.match(identity,/emit\('identity-change',null\)/);
});
test('member workspace keeps five familiar tabs, but uses only SSO personal and shared APIs',()=>{
 for(const tab of ['list','stat','add','investments','finance']){
  assert.match(workspace,new RegExp("tab==='"+tab+"'"));
 }
 assert.match(workspace,/\/api\/family-finance\/'\+path/);
 for(const path of ['accounts','personal/assets','shared/entries']){
  assert.match(workspace,new RegExp(path.replace('/','\\/')));
 }
 assert.match(workspace,/api\('shared\/stats\?month='/);
 assert.match(workspace,/api\('shared\/stats\?year='/);
 assert.match(workspace,/x\.owner_user_id!==user/);
 assert.match(workspace,/owner_user_id===props\.user\.user_id/);
 assert.match(workspace,/user-id="user\.user_id"/);
 assert.match(workspace,/FamilyRecurringFinance/);
 assert.match(workspace,/FamilyFinanceProposals/);
 assert.doesNotMatch(workspace,/\bapi\('payment-sources'\)|\bapi\('investment-portfolio'\)|\/api\/auth\/login/);
});
