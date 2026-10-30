import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {detectPrepaidRecharge,prepaidTarget,prepaidBalance} from '../src/prepaid-card.js'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')

test('recharge detector requires an explicitly registered transit card and recharge wording',()=>{
  assert.equal(detectPrepaidRecharge('Suica チャージ ¥3000',['Suica','PASMO']),'Suica')
  assert.equal(detectPrepaidRecharge('PASMO入金 2000円',['Suica','PASMO']),'PASMO')
  assert.equal(detectPrepaidRecharge('Suica 乗車 220円',['Suica','PASMO']),'')
  assert.equal(detectPrepaidRecharge('Suica チャージ ¥3000',[]),'')
  assert.equal(detectPrepaidRecharge('カード入金 ¥3000',['Suica','PASMO']),'')
  assert.equal(detectPrepaidRecharge('Suica チャージ 3000',['Suica','モバイルSuica']),'')
  assert.equal(prepaidTarget('Suica'),'prepaid:Suica')
  assert.equal(prepaidBalance({opening_balance:1000,charged:3000,spent:220}),3780)
})

test('card settings own type only; asset page owns opening balance field',()=>{
  const finance=read('src/FinanceTools.vue')
  const assets=read('src/PrepaidAssets.vue')
  const api=read('functions/api/prepaid-assets.js')
  assert.match(finance,/カード種別|新しいカードの種類/)
  assert.doesNotMatch(finance,/v-model(?:\.number)?="openingBalance"|v-model(?:\.number)?="editOpeningBalance"/)
  assert.match(finance,/期首残高は「資産」画面から設定します/)
  assert.match(assets,/期首残高を設定・修正/)
  assert.match(assets,/v-model\.number="openingDraft"/)
  assert.match(assets,/prepaid-assets\/opening/)
  assert.match(api,/UPDATE payment_sources SET opening_balance=\?1/)
  assert.doesNotMatch(api,/UPDATE entries SET|INSERT INTO entries/)
})

test('migration adds columns only without any table creation or historical reclassification',()=>{
  const migration=read('migrations/0007_prepaid_card_assets.sql')
  const api=read('functions/api/[[path]].js')
  assert.match(migration,/ALTER TABLE payment_sources ADD COLUMN source_type/)
  assert.match(migration,/ALTER TABLE payment_sources ADD COLUMN opening_balance/)
  assert.doesNotMatch(migration,/CREATE TABLE|DELETE FROM|UPDATE entries|DROP TABLE|INSERT INTO/)
  assert.match(api,/if \(a === 'prepaid-assets'\)/)
  assert.match(api,/if \(a === 'investments'\) return json\(/)
  assert.doesNotMatch(api,/SELECT .*FROM investment_snapshots|UPDATE investment_snapshots|INSERT INTO investment_snapshots/)
  assert.match(api,/transfer_target=\?1 WHERE transfer_target=\?2/)
})

test('charge is asset movement and spend remains expense; UI supports both editing paths',()=>{
  const app=read('src/App.vue')
  const form=read('src/TransactionForm.vue')
  const ledger=read('src/pages/LedgerPage.vue')
  const asset=read('src/pages/AssetsPage.vue')
  assert.match(app,/matchingPrepaid=effectiveMode==='receipt'\|\|effectiveMode==='statement'/)
  assert.match(app,/matchingPrepaid \? prepaidTarget\(matchingPrepaid\)/)
  assert.match(form,/transferDestinations/)
  assert.match(form,/チャージ元（任意）/)
  assert.match(ledger,/transfer-destinations="transferDestinations"/)
  assert.match(asset,/PrepaidAssets/)
})
