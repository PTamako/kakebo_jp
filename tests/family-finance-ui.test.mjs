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
 assert.match(source,/body:JSON\.stringify\(\{version:a\.version,\.\.\.change,expected_user_id:actor\}\)/);
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
 assert.match(proposals,/提交不代表入账，管理员批准后仍需单独执行/);
 assert.match(proposals,/encodeURIComponent\(item.request_id\)\+'\/'\+kind/);
 assert.match(proposals,/result.applied===true\|\|result.ledger_changed!==false/);
 assert.match(proposals,/await load\(offset.value\)/);
 assert.match(proposals,/@click="action\(item,'submit'\)"/);
 assert.match(proposals,/@click="action\(item,'cancel'\)"/);
 assert.doesNotMatch(proposals,/setInterval\(|setTimeout\(/);
});

test('Safari foreground hides previous account finance and private proposals before a new verified login',()=>{
 assert.match(source,/function foreground\(\)\{/);
 assert.match(source,/if\(document.visibilityState!=='visible'\)return/);
 assert.match(source,/function resetIdentity\(\)\{[\s\S]*?person.value=null;accounts.value=\[\];totals.value=null;annual.value=null/);
 assert.match(source,/editing.value=null;rename.value='';newLabel.value='';newKind.value='credit_card'/);
 assert.match(source,/void check\(\)/);
 assert.match(source,/:key="'proposals:'\+person.user_id"/);
 assert.match(proposals,/onUnmounted\(\(\)=>\{/);
 assert.match(proposals,/alive=false;revision\+\+;open.value=false;items.value=\[\]/);
 assert.doesNotMatch(proposals,/localStorage\.getItem|indexedDB\.open|sessionStorage/);
});


test('switching HomeFlow users while a finance mutation is in flight never reopens old account state',()=>{
 assert.match(source,/function foreground\(\)\{[\s\S]*?resetIdentity\(\)[\s\S]*?void check\(\)/);
 assert.match(source,/async function logout\(\)\{[\s\S]*?resetIdentity\(\)[\s\S]*?await call\('\/api\/homeflow-sso\/logout'/);
 assert.match(source,/async function createAccount\(\)\{[\s\S]*?const revision=epoch,actor=person\.value\.user_id/);
 assert.match(source,/async function mutate\(a,change\)\{[\s\S]*?const revision=epoch,actor=person\.value\.user_id/);
 assert.equal((source.match(/if\(revision!==epoch\|\|person\.value\?\.user_id!==actor\)return/g)||[]).length,2);
 assert.match(source,/onUnmounted\(\(\)=>\{resetIdentity\(\)/);
 assert.match(source,/newLabel\.value='';newKind\.value='credit_card'/);
 // No saved financial form, private account lists or ledger caches across users.
 assert.doesNotMatch(source,/localStorage\.setItem\([^\n]*(?:account|ledger|totals)/i);
})

test('personal financial account mutation uses originating HomeFlow user, not stale session cookie',()=>{
 const api=readFileSync(new URL('../functions/api/family-finance/[[path]].js',import.meta.url),'utf8');
 assert.equal((api.match(/data.expected_user_id!==user.user_id/g)||[]).length,2);
 assert.equal((api.match(/code:'ACTOR_CHANGED'/g)||[]).length,2);
 assert.match(source,/body:JSON.stringify\(\{label,account_kind:newKind.value,expected_user_id:actor\}\)/);
 assert.match(source,/body:JSON.stringify\(\{version:a.version,\.\.\.change,expected_user_id:actor\}\)/);
 assert.match(source,/const revision=epoch,actor=person.value.user_id/);
 assert.match(source,/revision!==epoch\|\|person.value\?\.user_id!==actor/);
 assert.match(source,/function foreground\(\)\{[\s\S]*?resetIdentity\(\)[\s\S]*?void check\(\)/);
 assert.doesNotMatch(source,/localStorage.setItem\([^\n]*(?:ledger|account|balance)/i);
});


test('member can compose a private encrypted proposal only for her own stable account, never directly post a ledger row',()=>{
 assert.match(proposals,/const myAccounts=computed\(\(\)=>props.accounts.filter/);
 assert.match(proposals,/a\?\.owner_user_id===props.userId&&a.origin==='member_created'/);
 assert.match(proposals,/Number\(a.is_archived\)===0/);
 assert.match(proposals,/@submit.prevent="createProposal"/);
 assert.match(proposals,/!myAccounts.value.some\(a=>a.account_id===record.account_id\)/);
 assert.match(proposals,/!Number.isSafeInteger\(record.amount_jpy\)/);
 assert.match(proposals,/crypto.randomUUID\(\).replace\(\/-\/g,''\)/);
 assert.match(proposals,/if\(frozenDraft\)\{/);
 assert.match(proposals,/body:JSON.stringify\(frozenDraft\)/);
 assert.match(proposals,/idempotency_key:crypto.randomUUID/);
 assert.match(proposals,/result.prepared\?\.status!=='prepared_not_submitted'/);
 assert.match(proposals,/result.prepared\?\.ledger_changed!==false/);
 assert.match(proposals,/user!==props.userId\|\|!open.value/);
 assert.match(proposals,/加密草稿已保存，仍需在下方点击/);
 assert.match(proposals,/form class="hf-new-request"/);
 assert.doesNotMatch(proposals,/\/api\/entries\b|\/api\/internal\/approved-actions/);
 assert.doesNotMatch(proposals,/localStorage|sessionStorage|indexedDB/);
});


test('finance proposal create, submit, cancellation and approval proof bind to the original HomeFlow user',()=>{
 const pending=readFileSync(new URL('../functions/api/family-finance/pending.js',import.meta.url),'utf8')
 const submitted=readFileSync(new URL('../functions/api/family-finance/approval-submit.js',import.meta.url),'utf8')
 const proof=readFileSync(new URL('../functions/api/family-finance/approval-proof.js',import.meta.url),'utf8')
 assert.match(proposals,/idempotency_key:crypto.randomUUID\(\).replace\(\/-\/g,''\),\s*expected_user_id:user/)
 assert.match(proposals,/body:JSON.stringify\(\{expected_user_id:user\}\)/)
 assert.match(pending,/if\(data.expected_user_id!==user.user_id\)return json\(\{code:'ACTOR_CHANGED'\},403\)/)
 assert.match(pending,/if\(body.expected_user_id!==user.user_id\)return json\(\{code:'ACTOR_CHANGED'\},403\)/)
 assert.match(submitted,/if\(input.expected_user_id!==user.user_id\)/)
 assert.match(proof,/if\(form.expected_user_id!==user.user_id\)/)
 assert.doesNotMatch(proposals,/localStorage|sessionStorage|indexedDB|\/api\/entries/)
})
