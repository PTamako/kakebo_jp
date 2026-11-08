import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {validateLedgerTextFields} from '../functions/api/ledger-input-validation.js'

const source = path => readFileSync(new URL('../'+path,import.meta.url),'utf8')

test('entry validation accepts genuine Japanese ledger and long but bounded OCR',()=>{
  const row={date:'2026-11-08',type:'expense',category:'食費',merchant:'スーパー',note:'メモ',
    raw:'認識テキスト'.repeat(1000),transferTarget:'prepaid:モバイルSuica'}
  assert.equal(validateLedgerTextFields(row),null)
  assert.equal(validateLedgerTextFields({type:'income',category:'ポイント還元',rewardDestination:'credit:楽天カード'}),null)
})
test('malformed text and unknown types are rejected before database writes',()=>{
  assert.equal(validateLedgerTextFields(null).code,'invalid_entry')
  assert.equal(validateLedgerTextFields([]).code,'invalid_entry')
  assert.equal(validateLedgerTextFields({merchant:{x:1}}).code,'invalid_entry_text')
  assert.equal(validateLedgerTextFields({note:'x'.repeat(2001)}).code,'invalid_entry_text')
  assert.equal(validateLedgerTextFields({category:'x'.repeat(121)}).code,'invalid_entry_text')
  assert.equal(validateLedgerTextFields({raw:'x'.repeat(20001)}).code,'invalid_entry_text')
  assert.equal(validateLedgerTextFields({type:'refund'}).code,'invalid_entry_type')
  assert.equal(validateLedgerTextFields({transferTarget:['sbi']}).code,'invalid_transfer_target')
})
test('both POST and PUT validate before any entries SQL writes',()=>{
  const api=source('functions/api/[[path]].js')
  assert.match(api,/import \{ validateLedgerTextFields \} from '\.\/ledger-input-validation\.js'/)
  const entries=api.slice(api.indexOf("if (a === 'entries')"))
  for(const marker of ["if (m === 'POST')","if (m === 'PUT' && b)"]){
    const i=entries.indexOf(marker)
    const slice=entries.slice(i,i+440)
    assert.match(slice,/validateLedgerTextFields\(e\)/)
    assert.match(slice,/textProblem\) return json/)
  }
})
test('management and ledger share authoritative D1 category labels',()=>{
  const app=source('src/App.vue')
  const management=source('src/FinanceTools.vue')
  assert.match(app,/:category-display-names="categoryDisplayNames"/)
  assert.match(management,/categoryDisplayNames: \{ type: Object/)
  assert.match(management,/const categoryLabel = category => props\.categoryDisplayNames\[category\] \|\| category/)
  assert.doesNotMatch(management,/const categoryJapaneseLabels =/)
})
test('legacy card bill PUT computes from D1, not supplied client totals',()=>{
  const api=source('functions/api/[[path]].js')
  const start=api.indexOf("if (m === 'PUT') {",api.indexOf("if (a === 'recurring-plans' || a === 'card-bills')"))
  const end=api.indexOf('// Restore uses POST',start)
  assert.ok(start>0 && end>start,'legacy PUT guard is present')
  const guarded=api.slice(start,end)
  assert.match(guarded,/SUM\(CASE WHEN type='income' THEN -amount ELSE amount END\)/)
  assert.match(guarded,/source_type='standard'/)
  assert.match(guarded,/calculatedOnServer:true/)
  assert.doesNotMatch(guarded,/\.bind\(item\.name,item\.month,item\.start,item\.end,item\.total/)
})
