import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {matchesPrepaidHistoryEntry} from '../src/prepaid-history.js'
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
 assert.match(app,/matchesPrepaidHistoryEntry\(entry, prepaidHistoryFilter\.value\)/)
 assert.match(read('src/prepaid-history.js'),/entry\.transfer_target === prepaidTarget\(filter\.card\)/)
 assert.match(read('src/prepaid-history.js'),/entry\.payment_source === filter\.card/)
 assert.match(app,/\.filter\(entryMatchesType\)\.filter\(matchesPrepaidHistory\)/)
 assert.match(ledger,/v-if="!detailFilter && !prepaidHistoryFilter"/)
 assert.match(ledger,/v-if="prepaidHistoryFilter" class="detail-filter-strip"/)
 assert.match(app,/function clearDetailFilter\(\) \{[\s\S]*?prepaidHistoryFilter\.value = null/)
 assert.match(app,/function openLedgerFromNav\(\) \{[\s\S]*?prepaidHistoryFilter\.value = null/)
})

test('new prepaid names are dynamic: no special-case Suica or PASMO requirement',()=>{
 const arbitraryName='自分専用ウォレット 01'
 const charge={type:'transfer',transfer_target:'prepaid:'+arbitraryName,amount:2500}
 const usage={type:'expense',payment_source:arbitraryName,amount:120}
 assert.equal(matchesPrepaidHistoryEntry(charge,{card:arbitraryName,kind:'charge'}),true)
 assert.equal(matchesPrepaidHistoryEntry(usage,{card:arbitraryName,kind:'usage'}),true)
 assert.equal(matchesPrepaidHistoryEntry(charge,{card:'Suica',kind:'charge'}),false)
 assert.equal(matchesPrepaidHistoryEntry(usage,{card:'PASMO',kind:'usage'}),false)
 assert.match(wallet,/v-for="card in \(showAll \? data.cards : data.cards.slice\(0,2\)\)"/)
 assert.match(app,/prepaidSources\.value\.includes\(cardName\)/)
})

test('navigation does not re-import old payment settings or create D1 history',()=>{
 assert.doesNotMatch(wallet,/prepaid-assets\/initialize|INSERT INTO/)
 assert.doesNotMatch(app,/payment-sources\/initialize|readLegacyPaymentSources/)
 assert.match(app,/const cards = await api\('payment-sources'\)/)
})

test('Suica history never includes PASMO, ordinary transfers, income or other expenses',()=>{
 const entries=[
  {type:'transfer',transfer_target:'prepaid:Suica',amount:3000},
  {type:'transfer',transfer_target:'prepaid:PASMO',amount:4000},
  {type:'transfer',transfer_target:'sbi',amount:15000},
  {type:'expense',payment_source:'Suica',amount:210},
  {type:'expense',payment_source:'PASMO',amount:180},
  {type:'income',payment_source:'Suica',amount:100}
 ]
 assert.deepEqual(entries.filter(e=>matchesPrepaidHistoryEntry(e,{card:'Suica',kind:'charge'})),[entries[0]])
 assert.deepEqual(entries.filter(e=>matchesPrepaidHistoryEntry(e,{card:'PASMO',kind:'charge'})),[entries[1]])
 assert.deepEqual(entries.filter(e=>matchesPrepaidHistoryEntry(e,{card:'Suica',kind:'usage'})),[entries[3]])
 assert.deepEqual(entries.filter(e=>matchesPrepaidHistoryEntry(e,{card:'PASMO',kind:'usage'})),[entries[4]])
 assert.equal(matchesPrepaidHistoryEntry(entries[0],{card:'Suica',kind:'invalid'}),false)
 assert.equal(matchesPrepaidHistoryEntry(entries[0],null),true)
})
