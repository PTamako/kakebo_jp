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
 assert.match(wallet,/card\.name\+'の利用・振替履歴'/)
 assert.doesNotMatch(wallet,/wallet-recharge|data\.recharges|最近のチャージ/)
 assert.match(assets,/@open-history="openPrepaidHistoryDetails"/)
})

test('prepaid history navigates to current month in existing ledger tab',()=>{
 assert.match(app,/async function openPrepaidHistoryDetails\(cardName,kind\)/)
 assert.match(app,/prepaidSources\.value\.includes\(cardName\)/)
 assert.match(app,/const targetMonth = currentMonth\(\)/)
 assert.match(app,/month\.value = targetMonth/)
 assert.match(app,/tab\.value = 'list'/)
 assert.match(app,/entryTypeFilter\.value = 'all'/)
 assert.match(app,/openingEntryId:Number\(source\?\.opening_entry_id\|\|0\)/)
 assert.match(ledger,/prepaidHistoryFilter\.card \+ ' · '/)
})

test('prepaid history strictly filters the selected card and entry type',()=>{
 assert.match(app,/matchesPrepaidHistoryEntry\(entry, prepaidHistoryFilter\.value\)/)
 assert.match(read('src/prepaid-history.js'),/entry\.transfer_target===prepaidTarget\(filter\.card\)/)
 assert.match(read('src/prepaid-history.js'),/entry\.payment_source===filter\.card/)
 assert.match(app,/\.filter\(entryMatchesType\)\.filter\(matchesPrepaidHistory\)/)
 assert.match(ledger,/v-if="!detailFilter && !prepaidHistoryFilter"/)
 assert.match(ledger,/v-if="prepaidHistoryFilter" class="detail-filter-strip"/)
 assert.match(app,/function clearDetailFilter\(\) \{[\s\S]*?prepaidHistoryFilter\.value = null/)
 assert.match(app,/function openLedgerFromNav\(\) \{[\s\S]*?prepaidHistoryFilter\.value = null/)
})

test('new prepaid names are dynamic: no special-case Suica or PASMO requirement',()=>{
 const arbitraryName='自分専用ウォレット 01'
 const charge={id:11,date:'2026-10-29',type:'transfer',transfer_target:'prepaid:'+arbitraryName,amount:2500}
 const usage={id:12,date:'2026-10-29',type:'expense',payment_source:arbitraryName,amount:120}
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
  {id:1,date:'2026-10-29',type:'transfer',transfer_target:'prepaid:Suica',amount:3000},
  {id:2,date:'2026-10-29',type:'transfer',transfer_target:'prepaid:PASMO',amount:4000},
  {id:3,date:'2026-10-29',type:'transfer',transfer_target:'sbi',amount:15000},
  {id:4,date:'2026-10-29',type:'expense',payment_source:'Suica',amount:210},
  {id:5,date:'2026-10-29',type:'expense',payment_source:'PASMO',amount:180},
  {id:6,date:'2026-10-29',type:'income',payment_source:'Suica',amount:100}
 ]
 assert.deepEqual(entries.filter(e=>matchesPrepaidHistoryEntry(e,{card:'Suica',kind:'charge'})),[entries[0]])
 assert.deepEqual(entries.filter(e=>matchesPrepaidHistoryEntry(e,{card:'PASMO',kind:'charge'})),[entries[1]])
 assert.deepEqual(entries.filter(e=>matchesPrepaidHistoryEntry(e,{card:'Suica',kind:'usage'})),[entries[3]])
 assert.deepEqual(entries.filter(e=>matchesPrepaidHistoryEntry(e,{card:'PASMO',kind:'usage'})),[entries[4]])
 assert.equal(matchesPrepaidHistoryEntry(entries[0],{card:'Suica',kind:'invalid'}),false)
 assert.equal(matchesPrepaidHistoryEntry(entries[0],null),true)
})

test('wallet charge history agrees with balance date, transfer date, and opening-entry anchor',()=>{
 const today='2026-10-30'
 const card={card:'任意の新規カード',kind:'charge',openingDate:'2026-10-01',openingEntryId:10}
 const charge={id:11,date:'2026-10-29',type:'transfer',transfer_target:'prepaid:任意の新規カード',transfer_date:'2026-10-29',amount:3000}
 assert.equal(matchesPrepaidHistoryEntry(charge,card,today),true)
 assert.equal(matchesPrepaidHistoryEntry({...charge,transfer_date:'2026-11-10'},card,today),false,'unapplied future transfer is not in current balance/history')
 assert.equal(matchesPrepaidHistoryEntry({...charge,date:'2026-10-31'},card,today),false,'future ledger entry must not appear')
 assert.equal(matchesPrepaidHistoryEntry({...charge,id:10},card,today),false,'old entry already covered by opening balance')
 assert.equal(matchesPrepaidHistoryEntry({...charge,date:'2026-09-30'},card,today),true,'a transfer booked earlier but effective after the baseline counts')
 assert.equal(matchesPrepaidHistoryEntry({...charge,date:'2026-09-30',transfer_date:'2026-09-30'},card,today),false,'an already-effective old transfer remains in the baseline')
 assert.equal(matchesPrepaidHistoryEntry({...charge,transfer_target:'prepaid:違うカード'},card,today),false)
 const usage={id:12,date:'2026-10-28',type:'expense',payment_source:'任意の新規カード',amount:270}
 assert.equal(matchesPrepaidHistoryEntry(usage,{...card,kind:'usage'},today),true)
 assert.equal(matchesPrepaidHistoryEntry({...usage,id:10},{...card,kind:'usage'},today),false)
 assert.equal(matchesPrepaidHistoryEntry({...usage,date:'2026-11-01'},{...card,kind:'usage'},today),false)
 const sql=read('functions/api/prepaid-assets.js')
 assert.match(sql,/e\.id>p\.opening_entry_id/)
 assert.match(sql,/COALESCE\(e\.transfer_date,e\.date\)<=\?1/)
 assert.match(read('functions/api/[[path]].js'),/source_type,stat_group,opening_balance,opening_date,opening_entry_id/)
})

test('prepaid usage history includes source transfers only after effective date',()=>{
 const filter={card:'Suica',kind:'usage',openingDate:'2026-10-01',openingEntryId:2}
 const today='2026-10-30'
 const outgoing={id:5,date:today,type:'transfer',payment_source:'Suica',transfer_target:'prepaid:PASMO',transfer_date:today}
 assert.equal(matchesPrepaidHistoryEntry(outgoing,filter,today),true)
 assert.equal(matchesPrepaidHistoryEntry({...outgoing,transfer_date:'2026-10-31'},filter,today),false)
 assert.equal(matchesPrepaidHistoryEntry({...outgoing,payment_source:'現金'},filter,today),false)
 assert.equal(matchesPrepaidHistoryEntry({...outgoing,transfer_target:'prepaid:Suica'},filter,today),false)
 assert.equal(matchesPrepaidHistoryEntry({...outgoing,id:2},filter,today),false)
})
