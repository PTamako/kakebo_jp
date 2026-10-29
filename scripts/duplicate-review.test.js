import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {findLedgerDuplicateGroups,duplicateMerchantName} from '../src/duplicate-review.js'

const first = {
  id:101, date:'2026-10-28', time:'12:37', amount:311, type:'expense',
  merchant:'まいばすけっと 南小岩8丁目店', category:'饮食料品',
  payment_source:'QUICPay', note:'レシート読み取り',
}
const second = {
  id:102, date:'2026-10-28', time:'12:37', amount:'311', type:'expense',
  merchant:'まいばすけっと南小岩8丁目店', category:'飲食料品',
  payment_source:'', note:'', raw:'OCRからの別明細',
}
const groups = entries => findLedgerDuplicateGroups(entries)

test('screenshot: ¥311 same shop/date/time appears as one duplicate group despite spaces',()=>{
  const result=groups([{id:100,date:'2026-10-28',time:'21:05',amount:643,merchant:'ベルク高砂店',type:'expense'},first,second])
  assert.equal(result.length,1)
  assert.deepEqual(result[0].map(row=>row.id),[101,102])
  assert.equal(result[0][0].date,'2026-10-28')
})

test('fullwidth, incidental spaces and Japanese letter width do not hide duplicate shops',()=>{
  assert.equal(duplicateMerchantName('まいばすけっと　南小岩８丁目店'),duplicateMerchantName('まいばすけっと南小岩8丁目店'))
  assert.equal(groups([{...first,merchant:'まいばすけっと　南小岩８丁目店'},second]).length,1)
})

test('near times and unknown OCR time still show candidates for human review',()=>{
  assert.equal(groups([first,{...second,time:'12:42'}]).length,1)
  assert.equal(groups([first,{...second,time:''}]).length,1)
  assert.equal(groups([first,{...second,time:null}]).length,1)
})

test('later legitimate purchases, different merchants or amounts are not matched',()=>{
  assert.equal(groups([first,{...second,time:'13:15'}]).length,0)
  assert.equal(groups([first,{...second,date:'2026-10-29'}]).length,0)
  assert.equal(groups([first,{...second,amount:312}]).length,0)
  assert.equal(groups([first,{...second,merchant:'別のスーパー'}]).length,0)
  assert.equal(groups([first,{...second,type:'income'}]).length,0)
})

test('several groups are separated and ordered by most recent date',()=>{
  const earlier={...first,id:210,date:'2026-10-01',merchant:'ローソン',time:'09:00',amount:200}
  const matches=groups([earlier,{...earlier,id:211,time:'09:03'},first,second,{...earlier,id:212,time:'18:00'}])
  assert.equal(matches.length,2)
  assert.equal(matches[0][0].date,'2026-10-28')
  assert.equal(matches[1].length,2)
})

test('review helper does not mutate D1 rows or use strict backup transactionKey',()=>{
  const records=[first,second].map(row=>Object.freeze({...row}))
  const before=JSON.stringify(records)
  const found=groups(records)
  assert.equal(found.length,1)
  assert.equal(JSON.stringify(records),before)
  assert.strictEqual(found[0][0],records[0])
  const component=readFileSync(new URL('../src/FinanceTools.vue',import.meta.url),'utf8')
  const helper=readFileSync(new URL('../src/duplicate-review.js',import.meta.url),'utf8')
  assert.match(component,/computed\(\(\) => findLedgerDuplicateGroups\(rows\.value\)\)/)
  assert.match(component,/@toggle="refreshDuplicateReview"/)
  assert.match(component,/function refreshDuplicateReview\(event\)/)
  assert.match(component,/if \(busy\)/)
  assert.match(component,/重複候補を確認中/)
  assert.doesNotMatch(helper,/DELETE FROM|UPDATE entries|props\.api|fetch\(/)
  assert.match(component,/prepareRestoreRows\(rows\.value,backup\.entries\)/)
})
