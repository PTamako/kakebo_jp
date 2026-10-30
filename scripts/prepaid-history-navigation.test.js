import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const wallet=read('src/PrepaidAssets.vue')
const assets=read('src/pages/AssetsPage.vue')
const app=read('src/App.vue')
const ledger=read('src/pages/LedgerPage.vue')

test('each prepaid card exposes its own charge and usage links',()=>{
 assert.match(wallet,/@click="emit\('open-history',card\.name,'charge'\)"/)
 assert.match(wallet,/@click="emit\('open-history',card\.name,'usage'\)"/)
 assert.match(wallet,/card\.name\+'のチャージ履歴'/)
 assert.match(wallet,/card\.name\+'の利用履歴'/)
 assert.doesNotMatch(wallet,/wallet-recharge|data\.recharges|最近のチャージ/)
 assert.match(assets,/@open-history="openPrepaidHistoryDetails"/)
})

test('prepaid history navigates to current month in existing ledger tab',()=>{
 assert.match(app,/async function openPrepaidHistoryDetails\(cardName,kind\)/)
 assert.match(app,/prepaidSources\.value\.includes\(cardName\)/)
 assert.match(app,/const targetMonth = currentMonth\(\)/)
 assert.match(app,/month\.value = targetMonth/)
 assert.match(app,/tab\.value = 'list'/)
 assert.match(app,/entryTypeFilter\.value = kind === 'charge' \? 'transfer' : 'expense'/)
 assert.match(app,/prepaidHistoryFilter\.value = \{ card:cardName, kind \}/)
 assert.match(ledger,/prepaidHistoryFilter\.card \+ ' · '/)
})

test('prepaid history strictly filters the selected card and entry type',()=>{
 assert.match(app,/entry\.type === 'transfer' && entry\.transfer_target === prepaidTarget\(filter\.card\)/)
 assert.match(app,/filter\.kind === 'usage' && entry\.type === 'expense' && entry\.payment_source === filter\.card/)
 assert.match(app,/\.filter\(entryMatchesType\)\.filter\(matchesPrepaidHistory\)/)
 assert.match(ledger,/v-if="!detailFilter && !prepaidHistoryFilter"/)
 assert.match(ledger,/v-if="prepaidHistoryFilter" class="detail-filter-strip"/)
 assert.match(app,/function clearDetailFilter\(\) \{[\s\S]*?prepaidHistoryFilter\.value = null/)
 assert.match(app,/function openLedgerFromNav\(\) \{[\s\S]*?prepaidHistoryFilter\.value = null/)
})

test('navigation does not re-import old payment settings or create D1 history',()=>{
 assert.doesNotMatch(wallet,/prepaid-assets\/initialize|INSERT INTO/)
 assert.doesNotMatch(app,/payment-sources\/initialize|readLegacyPaymentSources/)
 assert.match(app,/const cards = await api\('payment-sources'\)/)
})
