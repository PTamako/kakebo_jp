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
  assert.match(finance,/<option value="standard">クレジットカード<\/option>/)
  assert.match(finance,/<option value="prepaid">プリペイドカード(?:（Suica・PASMO等）)?<\/option>/)
  assert.doesNotMatch(finance,/<option value="standard">通常の支払方法<\/option>/)
  assert.doesNotMatch(finance,/v-model(?:\.number)?="openingBalance"|v-model(?:\.number)?="editOpeningBalance"/)
  assert.match(finance,/期首残高は「資産」で設定できます。/)
  assert.match(assets,/class="wallet-opening-title"/)
  assert.match(assets,/@click="startOpening\(card\)"/)
  assert.match(assets,/role="dialog" aria-modal="true"/)
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

test('credit-card billing excludes prepaid and non-card payment methods',()=>{
  const finance=read('src/FinanceTools.vue')
  assert.match(finance,/const isCreditCard = name =>/)
  assert.match(finance,/props\.paymentSourceMeta\[name\]\?\.source_type === 'standard'/)
  assert.match(finance,/const creditCardSources = computed\(\(\) => orderedPayments\.value\.filter\(isCreditCard\)\)/)
  assert.match(finance,/v-for="source in creditCardSources"/)
  assert.match(finance,/watch\(creditCardSources, sources => \{/)
  assert.match(finance,/!isCreditCard\(bill\.value\.name\)/)
  assert.match(finance,/isCreditCard\(bill\.value\.name\) \? bills\.value\.filter/)
  assert.doesNotMatch(finance,/source_type!=='prepaid'/)
  assert.doesNotMatch(finance,/カードを選択<\/option><option v-for="source in orderedPayments\.filter/)
})
