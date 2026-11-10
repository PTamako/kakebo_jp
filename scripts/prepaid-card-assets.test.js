import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {detectPrepaidRecharge,prepaidTarget,prepaidBalance} from '../src/prepaid-card.js'
import {prepaidRestoreBalances,isFuturePrepaidMovement} from '../src/finance-tools.js'
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
  assert.equal(prepaidBalance({opening_balance:1000,charged:3000,spent:220,transferred_out:500}),3280)
  assert.equal(prepaidBalance({opening_balance:0,charged:0,earned:4,spent:0,transferred_out:4}),0)
})

test('newly registered prepaid card names work without a fixed brand list',()=>{
  assert.equal(detectPrepaidRecharge('nanaco チャージ 500円',['nanaco']),'nanaco')
  assert.equal(detectPrepaidRecharge('nanacoチャージ 176円',['nanacoモバイル','Suica']),'nanacoモバイル')
  // Arbitrary future registered prepaid accounts work without another code edit.
  assert.equal(detectPrepaidRecharge('PayPayマネーチャージ 1,000円',['PayPay マネーライト','Suica','nanacoモバイル']),'PayPay マネーライト')
  assert.equal(detectPrepaidRecharge('ＰａｙＰａｙ マネー チャージ ¥1000',['PayPay マネーライト']),'PayPay マネーライト')
  assert.equal(detectPrepaidRecharge('PayPayマネーライト入金 1000円',['PayPay マネーライト']),'PayPay マネーライト')
  assert.equal(detectPrepaidRecharge('PayPayチャージ 1000円',['PayPay マネーライト']),'')
  assert.equal(detectPrepaidRecharge('PayPayマネーチャージ 1000円',['PayPay マネーライト','PayPay マネー']),'')
  assert.equal(detectPrepaidRecharge('フューチャーペイチャージ',['フューチャーペイウォレット']),'フューチャーペイウォレット')
  assert.equal(detectPrepaidRecharge('スイカチャージ',['モバイルSuica']),'')
  assert.equal(detectPrepaidRecharge('Suicaチャージ',['モバイルSuica']),'モバイルSuica')
  assert.equal(detectPrepaidRecharge('普通の買い物',['PayPay マネーライト']),'')
  assert.equal(detectPrepaidRecharge('NANACO チャージ ¥176',['nanacoモバイル']),'nanacoモバイル')
  assert.equal(detectPrepaidRecharge('nanacoチャージ 176円',['nanacoモバイル','nanacoカード']),'')
  assert.equal(detectPrepaidRecharge('nanaco利用 176円',['nanacoモバイル']),'')
  assert.equal(detectPrepaidRecharge('nanacoチャージ 176円',['Suica']),'')
  assert.equal(detectPrepaidRecharge('Suicaチャージ',['Suica','モバイルSuica']),'')
  assert.equal(detectPrepaidRecharge('WAON入金 1000円',['WAON']),'WAON')
  assert.equal(detectPrepaidRecharge('楽天 Edy チャージ 1500円',['楽天Edy']),'楽天Edy')
  assert.equal(detectPrepaidRecharge('オリジナルカード　チャージ 400円',['オリジナルカード']),'オリジナルカード')
  assert.equal(detectPrepaidRecharge('オリジナルカード 利用 400円',['オリジナルカード']),'')
  assert.equal(detectPrepaidRecharge('オリジナルカード チャージ 400円',['別のカード']),'')
  assert.equal(detectPrepaidRecharge('電子マネー チャージ 500円',['電子マネー','電子マネーPlus']),'')
  assert.equal(detectPrepaidRecharge('電子マネーPlus チャージ 500円',['電子マネー','電子マネーPlus']),'')
  assert.equal(prepaidTarget('オリジナルカード'),'prepaid:オリジナルカード')
})

test('card settings own type only; asset page owns opening balance field',()=>{
  const finance=read('src/FinanceTools.vue')
  const assets=read('src/PrepaidAssets.vue')
  const api=read('functions/api/prepaid-assets.js')
  assert.match(finance,/カード種別|新しいカードの種類/)
  assert.match(finance,/value:'standard',label:'クレジットカード'/)
  assert.match(finance,/value:'prepaid',label:'プリペイドカード'/)
  assert.doesNotMatch(finance,/<option value="standard">通常の支払方法<\/option>/)
  assert.doesNotMatch(finance,/v-model(?:\.number)?="openingBalance"|v-model(?:\.number)?="editOpeningBalance"/)
  assert.match(finance,/期首残高は「残高」で設定できます。/)
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
  assert.match(app,/recognizeAssetTransfer\(\{/)
  assert.match(app,/transferTarget: detectedTransfer\.transferTarget \|\| f\.transferTarget \|\| ''/)
  assert.match(form,/transferDestinations/)
  assert.match(form,/チャージ元（任意）/)
  assert.match(form,/振替元（任意）/)
  assert.match(form,/record\.type==='transfer'[^>]*class="form-field"/)
  assert.match(ledger,/transfer-destinations="transferDestinations"/)
  assert.match(asset,/PrepaidAssets/)
})

test('credit-card billing excludes prepaid and non-card payment methods',()=>{
  const finance=read('src/FinanceTools.vue')
  assert.match(finance,/const isCreditCard = name =>/)
  assert.match(finance,/props\.paymentSourceMeta\[name\]\?\.source_type === 'standard'/)
  assert.match(finance,/const creditCardSources = computed\(\(\) => sortOtherLast\(\[\.\.\.orderedPayments\.value,[\s\S]*?\.\.\.archivedPaymentSources\.value\]\.filter\(isCreditCard\)\)\)/)
  assert.match(finance,/creditCardSources\.map\(source=>/)
  assert.match(finance,/watch\(creditCardSources, sources => \{/)
  assert.match(finance,/!isCreditCard\(bill\.value\.name\)/)
  assert.match(finance,/isCreditCard\(bill\.value\.name\) \? bills\.value\.filter/)
  assert.doesNotMatch(finance,/source_type!=='prepaid'/)
  assert.doesNotMatch(finance,/カードを選択<\/option><option v-for="source in orderedPayments\.filter/)
})

test('portable restore preserves wallet-to-wallet conservation and respects future transfer dates',()=>{
  const today='2026-10-30'
  const source={
    paymentSources:[
      {name:'Suica',source_type:'prepaid',opening_balance:5000,opening_date:'2026-10-01',opening_entry_id:0},
      {name:'PASMO',source_type:'prepaid',opening_balance:2000,opening_date:'2026-10-01',opening_entry_id:0}
    ],
    entries:[
      {id:1,date:today,type:'transfer',amount:1000,payment_source:'Suica',transfer_target:'prepaid:PASMO',transfer_date:today},
      {id:2,date:today,type:'expense',amount:300,payment_source:'Suica'},
      {id:3,date:today,type:'transfer',amount:200,payment_source:'Suica',transfer_target:'sbi',transfer_date:today}
    ]
  }
  assert.deepEqual(prepaidRestoreBalances(source,today),[
    {name:'Suica',openingBalance:3500},
    {name:'PASMO',openingBalance:3000}
  ])
  const future={id:4,date:today,type:'transfer',amount:300,payment_source:'Suica',transfer_target:'prepaid:PASMO',transfer_date:'2026-11-01'}
  assert.equal(isFuturePrepaidMovement(future,['Suica','PASMO'],today),true)
  // The future transfer stays out of the initial balance, and the restore
  // must append it AFTER the newly rebased anchor.
  assert.deepEqual(prepaidRestoreBalances({...source,entries:[...source.entries,future]},today),[
    {name:'Suica',openingBalance:3500},
    {name:'PASMO',openingBalance:3000}
  ])
})

test('backup restore includes earned points and holds future-dated point credits',()=>{
 const today='2026-11-07',tomorrow='2026-11-08'
 const archive={
   paymentSources:[{name:'ポイント還元',source_type:'prepaid',opening_balance:0,opening_date:today,opening_entry_id:2}],
   entries:[
     {id:1,date:today,type:'income',category:'ポイント還元',payment_source:'ポイント還元',amount:176},
     {id:2,date:today,type:'transfer',payment_source:'ポイント還元',transfer_target:'prepaid:Suica',transfer_date:today,amount:176},
     {id:3,date:today,type:'income',category:'ポイント還元',payment_source:'ポイント還元',amount:4},
     {id:4,date:today,type:'transfer',payment_source:'ポイント還元',transfer_target:'prepaid:Suica',transfer_date:today,amount:4},
     {id:5,date:tomorrow,type:'income',category:'ポイント還元',payment_source:'ポイント還元',amount:10}
   ]
 }
 assert.deepEqual(prepaidRestoreBalances(archive,today),[{name:'ポイント還元',openingBalance:0}])
 assert.equal(isFuturePrepaidMovement(archive.entries[4],['ポイント還元'],today),true)
 assert.equal(isFuturePrepaidMovement(archive.entries[2],['ポイント還元'],today),false)
})
