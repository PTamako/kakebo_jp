import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../src/FamilyFinanceAccess.vue',import.meta.url),'utf8');
const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8');

test('independent family account UI is gated and does not unlock shared legacy ledger auth',()=>{
 assert.match(source,/api\/homeflow-sso\/status/);
 assert.match(source,/enabled\.value=status\.enabled===true/);
 assert.match(source,/<section v-if="enabled"/);
 assert.match(source,/api\/family-finance\/status/);
 assert.match(source,/financeEnabled\.value=feature\.enabled===true/);
 assert.match(source,/user\.ledger_access===false/);
 assert.match(app,/<main v-if="locked"/);
 assert.match(app,/<FamilyFinanceAccess \/>/);
 assert.match(app,/<FamilyFinanceAccess v-if="tab === 'finance'"/);
 assert.doesNotMatch(source,/\/api\/entries\b|\/api\/auth\/login|AUTH_TOKEN/);
});
test('five-minute Safari proof remains separate from credentials; no bearer tokens stored',()=>{
 assert.match(source,/localStorage\.setItem\(STORAGE,JSON\.stringify\(proof\)\)/);
 assert.match(source,/localStorage\.removeItem\(STORAGE\)/);
 assert.match(source,/expires_at:Date\.now\(\)\+Math\.min\(300/);
 assert.match(source,/destination\.protocol!=='https:'\|\|destination\.pathname!=='\/authorize'/);
 assert.match(source,/body:JSON\.stringify\(\{state:pending\.value\.state,resume_secret:pending\.value\.resume_secret\}\)/);
 assert.match(source,/\/api\/homeflow-sso\/logout/);
 assert.doesNotMatch(source,/localStorage\.setItem\([^\n]*(access_token|session_assertion)/);
 assert.doesNotMatch(source,/document\.cookie\s*=/);
});
test('member account management respects server actor and version; no direct ledger writes',()=>{
 assert.match(source,/person\.value\.role==='owner'\|\|a\.owner_user_id===person\.value\.user_id/);
 assert.match(source,/a\.origin==='legacy'/);
 assert.match(source,/\/api\/family-finance\/accounts/);
 assert.match(source,/body:JSON\.stringify\(\{version:a\.version,\.\.\.change\}\)/);
 assert.match(source,/ledger_changed!==false/);
 assert.match(source,/\/api\/family-finance\/shared\/ledger-totals\?month=/);
 assert.doesNotMatch(source,/\/api\/family-finance\/shared\/entries.{0,60}POST/);
});
