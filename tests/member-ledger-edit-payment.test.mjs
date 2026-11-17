import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {ledgerPaymentLabel} from '../src/ledger-payment-label.js'

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
