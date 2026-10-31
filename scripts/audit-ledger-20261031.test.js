import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { paymentForDraft } from '../src/payment-rules.js'
import { detectIcHistoryContext } from '../src/transport-history.js'
import { monthLedgerMatchesStats } from '../src/month-ledger-consistency.js'
import { parseEntries } from '../src/parse.js'

test('unregistered OCR payment labels and stale rules never add virtual cards',()=>{
  const base={registeredSources:['Suica','セゾン'],defaultSource:'セゾン',merchant:'コンビニ'}
  assert.equal(paymentForDraft({...base,recognized:'QUICPay'}),'セゾン')
  assert.equal(paymentForDraft({...base,recognized:'偽のカード'}),'セゾン')
  assert.equal(paymentForDraft({...base,recognized:'Suica'}),'Suica')
  assert.equal(paymentForDraft({...base,recognized:'現金'}),'現金')
  assert.equal(paymentForDraft({...base,rules:[{keyword:'コンビニ',payment_source:'登録されていないカード'}]}),'セゾン')
})
test('Suica municipal transit context only for coherent scanned history',()=>{
  const rows=parseEntries('不明,不明,神奈川県横浜市,¥140,不明\n不明,不明,石川町駅,¥715,不明\n不明,不明,京成上野駅,¥272,不明',[])
  const context=detectIcHistoryContext(rows,['Suica','楽天カード'])
  assert.equal(context?.source,'Suica')
  assert.equal(context.municipalityFares.has(rows[0]),true)
  assert.equal(detectIcHistoryContext(rows,['楽天カード']),null)
  assert.equal(detectIcHistoryContext([{...rows[0],merchant:'コンビニ'},rows[1],rows[2]],['Suica']),null)
  assert.equal(detectIcHistoryContext([{...rows[0],paymentSource:'楽天カード'},rows[1],rows[2]],['Suica']),null)
})
test('day-only relative OCR does not invent an exact time',()=>{
  const rows=parseEntries('不明,2日前,石川町駅,¥175,不明\n不明,1週間前,京成上野駅,¥225,不明',[],new Date('2026-10-31T06:00:00Z'))
  assert.deepEqual(rows.map(x=>[x.date,x.time]),[['2026-10-29',''],['2026-10-24','']])
})
test('monthly ledger mismatch is rejected even when each API returned successfully',()=>{
  const rows=[{type:'expense',amount:100},{type:'income',amount:200},{type:'transfer',amount:300}]
  assert.equal(monthLedgerMatchesStats(rows,{total:100,count:1,income:200,transferTotal:300,transferCount:1}),true)
  assert.equal(monthLedgerMatchesStats(rows,{total:101,count:1,income:200,transferTotal:300,transferCount:1}),false)
})
test('imported duplicate overrides and stale updates are checked separately',()=>{
  const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
  assert.match(app,/duplicateConfirmedKeys\.has/)
  assert.match(app,/expected: Object\.fromEntries/)
})
