import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync(new URL('../src/FamilyFinanceAccess.vue',import.meta.url),'utf8');
const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8');
const proposals=readFileSync(new URL('../src/FamilyFinanceProposals.vue',import.meta.url),'utf8');

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

test('new family-member PWA does not get stuck in legacy code modal, with original path preserved while SSO OFF',()=>{
 assert.match(app,/async function routeNewFamilyMemberToIsolatedLogin\(\)/);
 assert.match(app,/status\.ok\|\|\(await status\.json\(\)\)\.enabled!==true\)return false/);
 assert.match(app,/if\(old\.status===401\)\{locked\.value=true;return true\}/);
 assert.match(app,/if \(!locked\.value && !await routeNewFamilyMemberToIsolatedLogin\(\)\)/);
 assert.match(app,/const old=await fetch\('\/api\/payment-sources',\{credentials:'same-origin',cache:'no-store'\}\)/);
});


test('household annual statistics are shared and do not expose a per-person summary selector',()=>{
 assert.match(source,/\/api\/family-finance\/shared\/year-summary\?year=/);
 assert.match(source,/yearly\.ledger_scope==='household'&&yearly\.complete===true/);
 assert.match(source,/selectedYear=ref\(month\.slice\(0,4\)\)/);
 assert.match(source,/@change="refresh"/);
 assert.match(source,/annual\.totals\.income/);
 assert.match(source,/annual\.totals\.expense/);
 assert.match(source,/annual\.net_income_expense/);
 assert.match(source,/annual\.totals\.transfer/);
 assert.match(source,/annual\.categories\.filter\(c=>c\.type==='expense'\)/);
 assert.doesNotMatch(source,/selectedAccountOwner|myStats|spouseStats/);
});

test('member-only proposal UI distinguishes HomeFlow submitted from durable Kakeibo applied',()=>{
 assert.match(source,/import FamilyFinanceProposals from '.\/FamilyFinanceProposals.vue'/);
 assert.match(source,/<FamilyFinanceProposals v-if="person.role==='member'"/);
 assert.match(source,/:key="'proposals:'\+person.user_id"/);
 assert.match(proposals,/\/api\/family-finance\/proposals\?offset=/);
 assert.match(proposals,/item\.status==='applied'/);
 assert.match(proposals,/item\.ledger_changed===true&&Number.isSafeInteger\(item.entry_id\)&&item.entry_id>0/);
 assert.match(proposals,/item\.ledger_changed===false&&item.entry_id===null/);
 assert.match(proposals,/submitted_status_unknown'\?'已提交 · HomeFlow 审批状态待核对'/);
 assert.match(proposals,/只有家計簿的真实入账回执才显示/);
 assert.match(proposals,/credentials:'same-origin',cache:'no-store'/);
 assert.match(proposals,/user!==props.userId\|\|!open.value/);
 assert.match(proposals,/alive=false;revision\+\+;open.value=false;items.value=\[\]/);
 assert.doesNotMatch(proposals,/localStorage|sessionStorage|indexedDB|Authorization|Bearer/);
 assert.doesNotMatch(proposals,/\/api\/entries|\/api\/internal\/approved-actions/);
});
test('member approval submission and cancellation only act on the authenticated original proposal id',()=>{
 assert.match(proposals,/item.status!=='prepared_not_submitted'/);
 assert.match(proposals,/!\['submit','cancel'\]\.includes\(kind\)/);
 assert.match(proposals,/window.confirm\(question\)/);
 assert.match(proposals,/家計簿.+?管理员批准后仍需单独执行/);
 assert.match(proposals,/encodeURIComponent\(item.request_id\)\+'\/'\+kind/);
 assert.match(proposals,/result.applied===true\|\|result.ledger_changed!==false/);
 assert.match(proposals,/await load\(offset.value\)/);
 assert.match(proposals,/@click="action\(item,'submit'\)"/);
 assert.match(proposals,/@click="action\(item,'cancel'\)"/);
 assert.doesNotMatch(proposals,/setInterval\(|setTimeout\(/);
});
