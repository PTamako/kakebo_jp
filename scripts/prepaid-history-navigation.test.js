import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const wallet=read('src/PrepaidAssets.vue')
const assets=read('src/pages/AssetsPage.vue')
const app=read('src/App.vue')
const ledger=read('src/pages/LedgerPage.vue')

test('wallet shows two history navigation actions instead of duplicating the charge list',()=>{
  assert.match(wallet,/チャージ履歴/)
  assert.match(wallet,/利用履歴/)
  assert.match(wallet,/@click="emit\('open-history','charge'\)"/)
  assert.match(wallet,/@click="emit\('open-history','usage'\)"/)
  assert.doesNotMatch(wallet,/wallet-recharge|data\.recharges|最近のチャージ/)
  assert.match(assets,/@open-history="openPrepaidHistoryDetails"/)
})

test('prepaid history opens the current month on the existing ledger tab',()=>{
  assert.match(app,/async function openPrepaidHistoryDetails\(kind\)/)
  assert.match(app,/const targetMonth = currentMonth\(\)/)
  assert.match(app,/month\.value = targetMonth/)
  assert.match(app,/tab\.value = 'list'/)
  assert.match(app,/entryTypeFilter\.value = kind === 'charge' \? 'transfer' : 'expense'/)
  assert.match(app,/prepaidHistoryFilter\.value = kind/)
  assert.match(ledger,/prepaidHistoryFilter === 'charge' \? 'チャージ履歴' : '利用履歴'/)
})

test('history filters exactly registered prepaid transfers or prepaid-paid expenses',()=>{
  assert.match(app,/entry\.type === 'transfer' && prepaidSources\.value\.some\(name => entry\.transfer_target === prepaidTarget\(name\)\)/)
  assert.match(app,/entry\.type === 'expense' && prepaidSources\.value\.includes\(entry\.payment_source\)/)
  assert.match(app,/\.filter\(entryMatchesType\)\.filter\(matchesPrepaidHistory\)/)
  assert.match(ledger,/v-if="!detailFilter && !prepaidHistoryFilter"/)
  assert.match(ledger,/v-if="prepaidHistoryFilter" class="detail-filter-strip"/)
  assert.match(app,/function clearDetailFilter\(\) \{[\s\S]*?prepaidHistoryFilter\.value = ''/)
  assert.match(app,/function openLedgerFromNav\(\) \{[\s\S]*?prepaidHistoryFilter\.value = ''/)
})

test('prepaid links and display-only navigation never write legacy or restored D1 data',()=>{
  assert.doesNotMatch(wallet,/prepaid-assets\/initialize|INSERT INTO/)
  assert.match(app,/const cards = await api\('payment-sources'\)/)
  assert.doesNotMatch(app,/payment-sources\/initialize|readLegacyPaymentSources/)
})
