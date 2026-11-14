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
 // Accounts create/update and legacy account adoption all require the
 // originating HomeFlow actor. Resource-owner adoption has an independent module.
 assert.equal((api.match(/code:'ACTOR_CHANGED'/g)||[]).length,3);
 const owners=readFileSync(new URL('../functions/api/family-finance/resource-owners.js',import.meta.url),'utf8');
 assert.match(owners,/body.expected_user_id!==user.user_id/);
 assert.match(owners,/code:'ACTOR_CHANGED'/);
 assert.match(api,/input.expected_user_id!==user.user_id/);
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


test('old payment mapping audit stays owner-only, read-only and does not assume duplicate labels imply ownership',()=>{
 const audit=readFileSync(new URL('../src/FamilyFinanceMappingAudit.vue',import.meta.url),'utf8')
 const route=readFileSync(new URL('../functions/api/family-finance/[[path]].js',import.meta.url),'utf8')
 const backend=readFileSync(new URL('../functions/api/family-finance/legacy-mapping-audit.js',import.meta.url),'utf8')
 assert.match(source,/import FamilyFinanceMappingAudit from '.\/FamilyFinanceMappingAudit.vue'/)
 assert.match(source,/<FamilyFinanceMappingAudit v-if="person.role==='owner'"/)
 assert.match(source,/:key="'mapping-audit:'\+person.user_id"/)
 assert.match(source,/:household-id="person.household_id"/)
 assert.match(audit,/\/api\/family-finance\/legacy\/mapping-audit/)
 assert.match(audit,/data\.read_only!==true\|\|data\.ledger_changed!==false/)
 assert.match(audit,/user!==props.userId\|\|household!==props.householdId/)
 assert.match(audit,/onUnmounted\(\(\)=>\{alive=false;revision\+\+/)
 assert.match(backend,/if\(user.role!=='owner'\)return json\(\{code:'OWNER_REQUIRED'\},403\)/)
 assert.match(backend,/account\?account\.account_id:null/)
 assert.match(backend,/historical_source_missing/)
 assert.match(route,/return auditLegacyFinanceMappings\(request,env,user\)/)
 assert.doesNotMatch(audit,/localStorage|sessionStorage|indexedDB|\/api\/entries/)
 assert.doesNotMatch(backend,/INSERT INTO|UPDATE entries|DELETE FROM|\.run\(/i)
})


test('only stable member-created cash account drafts can enter an executable HomeFlow review',()=>{
 const submit=readFileSync(new URL('../functions/api/family-finance/approval-submit.js',import.meta.url),'utf8');
 assert.match(submit,/a.account_kind,a.origin/);
 assert.match(submit,/row.account_kind!=='cash'\|\|row.origin!=='member_created'/);
 assert.match(submit,/code:'ACCOUNT_TYPE_NOT_EXECUTABLE'/);
 assert.match(submit,/applied:false,ledger_changed:false/);
 assert.match(proposals,/const canSubmitForExecution=item=>myAccounts.value.some/);
 assert.match(proposals,/a.account_id===item.account_id&&a.account_kind==='cash'/);
 assert.match(proposals,/\(kind==='submit'&&!canSubmitForExecution\(item\)\)/);
 assert.match(proposals,/:disabled="loading\|\|!!busy\|\|!canSubmitForExecution\(item\)"/);
 assert.match(proposals,/非现金账户暂不支持审批后的执行/);
 assert.match(proposals,/其他账户草稿继续保留/);
 // Neither the PWA nor the new rejection code posts finance entries directly.
 assert.doesNotMatch(proposals,/\/api\/entries\b|\/api\/internal\/approved-actions/);
});


test('verified original owner must explicitly fingerprint-confirm legacy row linkage with production flag still default off',()=>{
 const ui=readFileSync(new URL('../src/FamilyFinanceLegacyLink.vue',import.meta.url),'utf8')
 const backend=readFileSync(new URL('../functions/api/family-finance/legacy-entry-links.js',import.meta.url),'utf8')
 const route=readFileSync(new URL('../functions/api/family-finance/[[path]].js',import.meta.url),'utf8')
 const migration=readFileSync(new URL('../migrations/0027_family_legacy_entry_link_audit.sql',import.meta.url),'utf8')
 assert.match(source,/import FamilyFinanceLegacyLink from '.\/FamilyFinanceLegacyLink.vue'/)
 assert.match(source,/<FamilyFinanceLegacyLink v-if="person.role==='owner'"/)
 assert.match(source,/:key="'legacy-entry-links:'\+person.user_id"/)
 assert.match(ui,/requires_explicit_confirmation!==true/)
 assert.match(ui,/source_digest:item.source_digest,expected_user_id:user,confirm:true/)
 assert.match(ui,/window.confirm\(/)
 assert.match(ui,/user!==props.userId/)
 assert.match(ui,/household!==props.householdId/)
 assert.match(ui,/financial_values_changed!==false/)
 assert.match(backend,/KAKEIBO_LEGACY_ENTRY_LINKS_ENABLED==='true'/)
 assert.match(backend,/APP_ENV==='production'/)
 assert.match(backend,/if\(body.expected_user_id!==user.user_id\)/)
 assert.match(backend,/e.type IN \('income','expense'\)/)
 assert.match(backend,/a.origin='legacy'/)
 assert.match(backend,/AND family_account_id IS NULL/)
 assert.match(backend,/INSERT INTO family_finance_legacy_entry_links/)
 assert.match(backend,/AND EXISTS\(SELECT 1 FROM family_financial_accounts a/)
 assert.match(backend,/JOIN homeflow_identity_links l/)
 assert.match(route,/return legacyEntryLinks\(request,env,url,user\)/)
 assert.match(migration,/LEGACY_ENTRY_LINK_AUDIT_IMMUTABLE/)
 assert.doesNotMatch(ui,/localStorage|sessionStorage|indexedDB|\/api\/entries/)
 assert.doesNotMatch(backend,/UPDATE entries SET (?:amount|category|merchant|payment_source)/)
})


test('legacy owner audit separately reports claimed accounts and verified historical entry linkage progress',()=>{
 const source=readFileSync(new URL('../src/FamilyFinanceMappingAudit.vue',import.meta.url),'utf8')
 const backend=readFileSync(new URL('../functions/api/family-finance/legacy-mapping-audit.js',import.meta.url),'utf8')
 assert.match(source,/linked_entry_count/)
 assert.match(source,/linked_legacy_entry_count/)
 assert.match(source,/remaining_legacy_entry_count/)
 assert.match(source,/原历史收支：已关联稳定 ID/)
 assert.match(source,/待关联 \{\{summary.remaining_legacy_entry_count\}\}/)
 assert.match(backend,/e\.family_account_id/)
 assert.match(backend,/a\.origin='legacy'/)
 assert.match(backend,/a\.owner_user_id=\? AND a\.household_id=\?/)
 assert.match(backend,/AND e\.payment_source=a\.legacy_source_name/)
 assert.match(backend,/GROUP BY a\.legacy_source_name/)
 assert.match(backend,/remaining_legacy_entry_count:items.reduce/)
 assert.match(backend,/linked_legacy_entry_count:items.reduce/)
 assert.doesNotMatch(backend,/UPDATE entries|INSERT INTO entries|DELETE FROM entries|\.run\(/i)
})


test('dual legacy transfer owner mapping stays opt-in and accepts only two independently proven original-owner accounts',()=>{
 const ui=readFileSync(new URL('../src/FamilyFinanceLegacyTransferLink.vue',import.meta.url),'utf8')
 const api=readFileSync(new URL('../functions/api/family-finance/legacy-transfer-links.js',import.meta.url),'utf8')
 const router=readFileSync(new URL('../functions/api/family-finance/[[path]].js',import.meta.url),'utf8')
 const migration=readFileSync(new URL('../migrations/0028_family_legacy_transfer_ids.sql',import.meta.url),'utf8')
 assert.match(source,/import FamilyFinanceLegacyTransferLink from '.\/FamilyFinanceLegacyTransferLink.vue'/)
 assert.match(source,/<FamilyFinanceLegacyTransferLink v-if="person.role==='owner'"/)
 assert.match(source,/:key="'legacy-transfer-links:'\+person.user_id"/)
 assert.match(ui,/source_account_id:item.source_account_id,target_account_id:item.target_account_id/)
 assert.match(ui,/source_digest:item.source_digest,expected_user_id:user,confirm:true/)
 assert.match(ui,/financial_values_changed!==false/)
 assert.match(ui,/window.confirm\(/)
 assert.match(ui,/generation!==revision\|\|user!==props.userId/)
 assert.match(ui,/household!==props.householdId/)
 assert.match(api,/KAKEIBO_LEGACY_TRANSFER_LINKS_ENABLED==='true'/)
 assert.match(api,/APP_ENV==='production'/)
 assert.match(api,/body.expected_user_id!==user.user_id/)
 assert.match(api,/row.type!=='transfer'/)
 assert.match(api,/sa.origin='legacy'/)
 assert.match(api,/ta.origin='legacy'/)
 assert.match(api,/e.family_account_id IS NULL/)
 assert.match(api,/e.family_transfer_target_account_id IS NULL/)
 assert.match(api,/e.payment_source<>e.transfer_target/)
 assert.match(api,/body.source_account_id===body.target_account_id/)
 assert.match(api,/UPDATE entries SET family_account_id=\?,/)
 assert.match(api,/family_transfer_target_account_id=\?/)
 assert.match(api,/INSERT INTO family_finance_legacy_transfer_links/)
 assert.match(api,/AND type=\\?'transfer\\?'/)
 assert.match(router,/return legacyTransferLinks\(request,env,url,user\)/)
 assert.match(migration,/CHECK\(source_account_id<>target_account_id\)/)
 assert.match(migration,/LEGACY_TRANSFER_TARGET_MISMATCH/)
 assert.match(migration,/LEGACY_TRANSFER_AUDIT_IMMUTABLE/)
 assert.doesNotMatch(ui,/localStorage|sessionStorage|indexedDB|\/api\/entries/)
 assert.doesNotMatch(api,/UPDATE entries SET (?:amount|type|payment_source|transfer_target|category)/)
})


test('owner mapping dashboard separates ordinary entries and verified dual transfer progress, warning on partial links',()=>{
 const ui=readFileSync(new URL('../src/FamilyFinanceMappingAudit.vue',import.meta.url),'utf8')
 const backend=readFileSync(new URL('../functions/api/family-finance/legacy-mapping-audit.js',import.meta.url),'utf8')
 assert.match(backend,/type IN \('income','expense'\)/)
 assert.match(backend,/linked_legacy_transfer_count:confirmed/)
 assert.match(backend,/remaining_legacy_transfer_count:stats\[0\]/)
 assert.match(backend,/partial_legacy_transfer_count:stats\[1\]/)
 assert.match(backend,/unverified_linked_transfer_count:stats\[2\]-confirmed/)
 assert.match(backend,/family_finance_legacy_transfer_links l/)
 assert.match(backend,/e.family_account_id=l.source_account_id/)
 assert.match(backend,/e.family_transfer_target_account_id=l.target_account_id/)
 assert.match(ui,/历史转账：双向已关联/)
 assert.match(ui,/summary.remaining_legacy_transfer_count/)
 assert.match(ui,/summary.partial_legacy_transfer_count\|\|summary.unverified_linked_transfer_count/)
 assert.match(ui,/需人工核验，禁止自动补写/)
 assert.doesNotMatch(backend,/UPDATE entries|DELETE FROM entries|INSERT INTO entries|\.run\(/)
})

test('household owner-proven balance panel fetches on demand, clears data on actor switch and never guesses legacy owners',()=>{
 const ui=readFileSync(new URL('../src/FamilyFinanceAssetOwnership.vue',import.meta.url),'utf8')
 const backend=readFileSync(new URL('../functions/api/family-finance/asset-owner-projection.js',import.meta.url),'utf8')
 assert.match(source,/import FamilyFinanceAssetOwnership from '.\/FamilyFinanceAssetOwnership.vue'/)
 assert.match(source,/<FamilyFinanceAssetOwnership :key="'asset-provenance:'\+person.user_id"/)
 assert.match(ui,/\/api\/family-finance\/shared\/asset-summary/)
 assert.match(ui,/credentials:'same-origin',cache:'no-store'/)
 assert.match(ui,/user!==props.userId/)
 assert.match(ui,/household!==props.householdId/)
 assert.match(ui,/onUnmounted\(\(\)=>\{alive=false;generation\+\+/)
 assert.match(ui,/identity_status==='verified_legacy'/)
 assert.match(ui,/未核验不代表归其他成员/)
 assert.doesNotMatch(ui,/localStorage|sessionStorage|indexedDB|\/api\/entries/)
 assert.match(backend,/origin='legacy'/)
 assert.match(backend,/resource_kind='investment_holding'/)
 assert.match(backend,/resource_kind='card_bill'/)
 assert.match(backend,/proven\(account,'credit_card'\)/)
 assert.match(backend,/receipt\?\.owner_user_id===account.owner_user_id/)
 assert.match(backend,/owner_user_id:owner\|\|null/)
 assert.match(backend,/identity_status:owner\?'verified_legacy':'unverified'/)
 assert.doesNotMatch(backend,/UPDATE |DELETE FROM |INSERT INTO /)
})

test('legacy owner resource adoption PWA uses authenticated original actor and bounded idempotent resource batches',()=>{
 const ui=readFileSync(new URL('../src/FamilyFinanceOwnerAdoption.vue',import.meta.url),'utf8')
 const api=readFileSync(new URL('../functions/api/family-finance/resource-owners.js',import.meta.url),'utf8')
 assert.match(source,/import FamilyFinanceOwnerAdoption from '.\/FamilyFinanceOwnerAdoption.vue'/)
 assert.match(source,/<FamilyFinanceOwnerAdoption v-if="person.role==='owner'"/)
 assert.match(source,/:key="'resource-adoption:'\+person.user_id"/)
 assert.match(ui,/\/api\/family-finance\/legacy\/resource-owners/)
 assert.match(ui,/expected_user_id:props.userId/)
 assert.match(ui,/window.confirm\(/)
 assert.match(ui,/pending.value=null;success=true/)
 assert.match(ui,/frozen=pending.value/)
 assert.match(ui,/<select :value="kind"/)
 assert.doesNotMatch(ui,/<select v-model="kind"/)
 assert.match(ui,/data.owner_user_id!==actor/)
 assert.match(ui,/household!==props.householdId/)
 assert.match(ui,/document.addEventListener\('visibilitychange',foreground\)/)
 assert.match(ui,/onUnmounted\(\(\)=>\{/)
 assert.doesNotMatch(ui,/localStorage|sessionStorage|indexedDB|\/api\/entries/)
 for(const kind of ['recurring_plan','investment_plan','investment_plan_history',
  'investment_holding','card_bill'])assert.match(ui,new RegExp(kind))
 assert.match(api,/if\(user.role!=='owner'\)/)
 assert.match(api,/body.expected_user_id!==user.user_id/)
 assert.match(api,/source.slice\(0,50\)/)
 assert.match(api,/owner_user_id:user.user_id/)
 assert.match(api,/INSERT INTO family_financial_resource_owners/)
 assert.match(api,/await db.batch\(ops\)/)
 assert.doesNotMatch(api,/UPDATE entries|DELETE FROM entries|UPDATE investment|DELETE FROM investment/)
})
