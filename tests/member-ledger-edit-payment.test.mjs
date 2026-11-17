import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {ledgerPaymentLabel,ledgerTransferTargetLabel,ledgerTransferSourceLabel} from '../src/ledger-payment-label.js'

test('member payment editor is writable only for own approved cash or shared-card row',()=>{
 const workspace=readFileSync(new URL('../src/FamilyMemberWorkspace.vue',import.meta.url),'utf8')
 assert.match(workspace,/entry\.shared_entry_requester_user_id===props\.user\.user_id/)
 assert.match(workspace,/!entry\.family_account_id/)
 assert.match(workspace,/paymentReadOnly:false,paymentSource:source\?'shared:'\+source:'cash'/)
 assert.match(workspace,/paymentChanged=edited\.type==='expense'&&!edited\.paymentReadOnly/)
 assert.match(workspace,/ledgerChanged=fields\.some[\s\S]*\|\|paymentChanged/)
 assert.match(workspace,/selected\.kind==='shared'\?selected\.card\.card_name:''/)
 const ledger=readFileSync(new URL('../src/family-ledger-context.js',import.meta.url),'utf8')
 assert.match(ledger,/typeof paymentEditor==='function'\?paymentEditor\(entry\):null/)
 assert.match(ledger,/paymentOriginalChoice:payment\?\.paymentSource/)
 assert.match(ledger,/payment_source:null/)
 const form=readFileSync(new URL('../src/pages/LedgerPage.vue',import.meta.url),'utf8')
 assert.match(form,/:payment-read-only="!!editingEntry\.paymentReadOnly"/)
 assert.match(form,/:payment-choices="props\.member \? memberPaymentChoices : \[\]"/)
})

test('different users never gain edit permission from a displayed payment label',()=>{
 assert.equal(ledgerPaymentLabel({type:'expense',payment_source:null,
  payment_source_display:'个人支付方式'}),'个人支付方式')
 const workspace=readFileSync(new URL('../src/FamilyMemberWorkspace.vue',import.meta.url),'utf8')
 assert.match(workspace,/if\(!own\)return \{paymentReadOnly:true,paymentSource:ledgerPaymentLabel\(entry\)\}/)
 assert.match(workspace,/memberLedgerPaymentOptions=computed\(\(\)=>memberPaymentOptions\.value\.filter/)
 const form=readFileSync(new URL('../src/TransactionForm.vue',import.meta.url),'utf8')
 assert.match(form,/v-if="paymentReadOnly" class="payment-source-readonly"/)
 assert.match(form,/record\.paymentDisplay\|\|record\.paymentSource\|\|'未設定'/)
 assert.match(form,/<MobileChoiceSheet :model-value="record.paymentSource" v-else/)
})

test('cash is explicit only for changes; an unchanged approved card remains untouched',()=>{
 const requests=readFileSync(new URL('../src/FamilySharedMutationRequests.vue',import.meta.url),'utf8')
 assert.match(requests,/if\(input\?\.payment_source!=null\)/)
 assert.match(requests,/e\.payment_source=card/)
 const member=readFileSync(new URL('../functions/api/family-finance/shared-mutation-requests.js',import.meta.url),'utf8')
 assert.match(member,/cleanEntry\(x.entry,x.operation==='update'\)/)
 assert.match(member,/OTHER_MEMBERS_PAYMENT_READ_ONLY/)
 const execution=readFileSync(new URL('../functions/api/internal/shared-entries\/[[path]].js',import.meta.url),'utf8')
 assert.match(execution,/explicitPayment/)
 assert.match(execution,/SHARED_MUTATION_PAYMENT_OWNER_MISMATCH/)
 assert.match(execution,/SHARED_CARD_GRANT_REVOKED/)
})


test('member views spouse payment label without gaining source IDs or edit access',()=>{
 const api=readFileSync(new URL('../functions/api/family-finance/[[path]].js',import.meta.url),'utf8')
 assert.match(api,/payment_source_display:paymentLabel/)
 assert.match(api,/family_account_id:ownSource\?r\.family_account_id:null/)
 assert.match(api,/payment_account_owner_user_id:ownSource\?user\.user_id:null/)
 assert.match(api,/payment_source:ownSource\|\|grantedSpender\?r\.payment_source:null/)
 const form=readFileSync(new URL('../src/TransactionForm.vue',import.meta.url),'utf8')
 assert.match(form,/!props\.editMode\|\|!props\.paymentChoices\.length/)
 assert.match(form,/<MobileChoiceSheet :model-value="record.paymentSource" v-else/)
 const owner=readFileSync(new URL('../functions/api/family-finance/shared-entries.js',import.meta.url),'utf8')
 assert.match(owner,/ACCOUNT_LINKED_PAYMENT_REQUIRES_JOURNAL_CORRECTION/)
 assert.match(owner,/FROM family_legacy_card_spends/)
 assert.match(owner,/OTHER_MEMBERS_PAYMENT_READ_ONLY/)
})

test('income, transfer target and transfer source remain visible if spouse owns the choice',()=>{
 assert.equal(ledgerTransferTargetLabel({
  type:'transfer',transfer_target:null,transfer_target_display:'nanaco'}),'nanaco')
 assert.equal(ledgerTransferTargetLabel({
  type:'income',transfer_target:null,transfer_target_display:'楽天カード'}),'楽天カード')
 assert.equal(ledgerTransferTargetLabel({
  type:'transfer',transfer_target:'prepaid:交通系IC'}),'交通系IC')
 assert.equal(ledgerTransferTargetLabel({
  type:'transfer',transfer_target:'family:a123'}),'個人口座')
 assert.equal(ledgerTransferSourceLabel({
  type:'transfer',payment_source:null,payment_source_display:'PayPay Visa'}),'PayPay Visa')
 const form=readFileSync(new URL('../src/TransactionForm.vue',import.meta.url),'utf8')
 for(const symbol of ['categoryLocked','rewardLocked','transferLocked','transferSourceLocked'])
  assert.match(form,new RegExp('v-if="'+symbol+'"'))
 assert.match(form,/record\.transferDisplay\|\|record\.transferTarget/)
 assert.match(form,/record\.paymentDisplay\|\|record\.paymentSource/)
 assert.match(form,/missingSavedCategory/)
 const ledger=readFileSync(new URL('../src/family-ledger-context.js',import.meta.url),'utf8')
 assert.match(ledger,/transferTarget:entry\.transfer_target\|\|''/)
 assert.match(ledger,/transferReadOnly:true,transferSourceReadOnly:true/)
 assert.match(ledger,/rewardDisplay:ledgerTransferTargetLabel\(entry\),rewardReadOnly:true/)
})

test('stat category details are genuinely filtered for both month and year',()=>{
 const stats=readFileSync(new URL('../src/family-stats-context.js',import.meta.url),'utf8')
 const ledger=readFileSync(new URL('../src/family-ledger-context.js',import.meta.url),'utf8')
 const page=readFileSync(new URL('../src/pages/StatisticsPage.vue',import.meta.url),'utf8')
 const work=readFileSync(new URL('../src/FamilyMemberWorkspace.vue',import.meta.url),'utf8')
 const api=readFileSync(new URL('../functions/api/family-finance/[[path]].js',import.meta.url),'utf8')
 assert.match(stats,/onCategoryDetails\(category,type,period\)/)
 assert.match(ledger,/e\.category===detailFilter\.value\.category/)
 assert.match(ledger,/async function openCategoryDetails\(category,type,period\)/)
 assert.match(ledger,/annualDetailMode=computed\(\(\)=>detailFilter\.value\?\.period==='year'\)/)
 assert.match(ledger,/await loadAnnual\(String\(selectedYear\.value\)\)/)
 assert.match(work,/annualEntries:annualLedgerEntries,loadAnnual:loadAnnualLedgerYear/)
 assert.match(work,/onCategoryDetails:memberLedger\.openCategoryDetails/)
 assert.match(api,/const annual=url\.searchParams\.get\('year'\)/)
 assert.doesNotMatch(page,/categoryDetail\?\.period/)
})
