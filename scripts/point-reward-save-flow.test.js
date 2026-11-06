import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

// Exercise the actual App.vue saveAll body. A syntax-only build cannot catch
// variables declared in the duplicate-check try block but used during POST.
const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
const match = app.match(/async function saveAll\(\) \{[\s\S]*?\n\}\nconst ledgerRevision =/)
assert.ok(match, 'saveAll can be extracted for a behavioral regression test')
const saveAllSource = match[0].replace(/\nconst ledgerRevision =$/, '')

const draft = (target, type='income') => ({
  date:'2026-11-06', time:'17:27', amount:4,
  type, category:type==='income'?'ポイント還元':'日用品',
  rewardDestination:target, paymentSource:type==='expense'?'楽天カード':'',
  merchant:'', note:'', transferTarget:''
})

function harness(drafts, history=[], acceptDuplicate=true) {
  const forms = {value:drafts.map(row=>({...row}))}
  const busy={value:''}, receiptSaveError={value:''}, pendingReceiptImage={value:null}
  const ledgerRevision={value:0}, input={value:'existing scan text'}, rules={value:[]}
  const calls=[], notices=[]
  let confirmations=0, draftPersists=0
  const api=async (route,options={})=>{
    if(route==='entries'){
      const data=JSON.parse(options.body)
      calls.push(data)
      return {id:42}
    }
    if(route==='rules')return []
    return {}
  }
  const args = {
    forms,busy,receiptSaveError,pendingReceiptImage,ledgerRevision,input,rules,
    api,flash:message=>notices.push(String(message)),
    fetchMonthEntries:async()=>history,
    confirm:()=>{confirmations++;return acceptDuplicate},
    nextTick:async()=>{},
    persistDraftLocally:async()=>{draftPersists++},
    syncDraftToD1:()=>{},
    loadPaymentSettings:async()=>{},
    load:async()=>{},loadYear:async()=>{},loadTransfers:async()=>{},
    persistReceipt:async()=>{},
    crypto:{randomUUID:()=> '9d4b16c8-3f51-4774-9cbe-98b0b58a4a2e'}
  }
  const run = new Function(...Object.keys(args),saveAllSource+'\nreturn saveAll')(...Object.values(args))
  return {run,forms,busy,ledgerRevision,calls,notices,
    get confirmations(){return confirmations},
    get draftPersists(){return draftPersists}}
}

test('¥4 Suica points income reaches the API and clears its draft', async () => {
  const h=harness([draft('prepaid:Suica')])
  await h.run()
  assert.equal(h.calls.length,1)
  assert.equal(h.calls[0].amount,4)
  assert.equal(h.calls[0].rewardDestination,'prepaid:Suica')
  assert.equal(h.calls[0].allowDuplicate,false)
  assert.equal(h.forms.value.length,0)
  assert.equal(h.ledgerRevision.value,1)
  assert.equal(h.busy.value,'')
  assert.ok(h.notices.some(msg=>/1件の記録を保存しました/.test(msg)))
  assert.ok(!h.notices.some(msg=>/sourceForDuplicate|0件を保存しました/.test(msg)))
})

test('confirmed duplicate points cashback preserves approval for prepaid wallet',async()=>{
  const historical=[{date:'2026-11-06',amount:4,merchant:'',type:'income',payment_source:'ポイント還元'}]
  const h=harness([draft('prepaid:Suica')],historical)
  await h.run()
  assert.equal(h.confirmations,1)
  assert.equal(h.calls.length,1)
  assert.equal(h.calls[0].allowDuplicate,true)
  assert.equal(h.forms.value.length,0)
})

test('credit-card reward duplicate matching uses its selected card name',async()=>{
  const historical=[{date:'2026-11-06',amount:4,merchant:'',type:'income',payment_source:'楽天カード'}]
  const h=harness([draft('credit:楽天カード')],historical)
  await h.run()
  assert.equal(h.confirmations,1)
  assert.equal(h.calls[0].rewardDestination,'credit:楽天カード')
  assert.equal(h.calls[0].allowDuplicate,true)
})

test('ordinary card expense still saves without reward destination',async()=>{
  const h=harness([draft('', 'expense')])
  await h.run()
  assert.equal(h.calls.length,1)
  assert.equal(h.calls[0].type,'expense')
  assert.equal(h.calls[0].allowDuplicate,false)
})
