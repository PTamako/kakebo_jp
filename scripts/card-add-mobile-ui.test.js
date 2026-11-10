import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const finance=read('src/FinanceTools.vue')
const sheet=read('src/MobileCardEditorSheet.vue')
const api=read('functions/api/[[path]].js')

test('card selector and toolbar stay on the main page while add/edit use a shared bottom sheet',()=>{
  assert.match(finance,/<MobileChoiceSheet v-model="selectedCard"/)
  assert.match(finance,/@click="selectCardForEdit"/)
  assert.match(finance,/@click="cardMode = 'add'"/)
  assert.match(finance,/<MobileCardEditorSheet :mode="cardMode"/)
  assert.match(finance,/:on-save="saveCardFromSheet"/)
  assert.match(finance,/:on-danger="runCardDanger"/)
  assert.doesNotMatch(finance,/<div v-if="cardMode === 'add'"/)
  assert.doesNotMatch(finance,/<div v-if="cardMode === 'edit'"/)
  assert.match(sheet,/<Teleport to="body">/)
  assert.match(sheet,/role="dialog"/)
  assert.match(sheet,/aria-modal="true"/)
  assert.match(sheet,/isEdit\?'カードを編集':'カードを追加'/)
  assert.match(sheet,/class="card-editor-backdrop"/)
  assert.match(sheet,/border-radius:22px 22px 0 0/)
})

test('shared form drafts card name, type, payment statistics and closing date',()=>{
  assert.match(sheet,/v-model="name"/)
  assert.match(sheet,/v-model="sourceType"/)
  assert.match(sheet,/v-model="statGroup"/)
  assert.match(sheet,/v-model="closingDay"/)
  assert.match(sheet,/value:'standard',label:'クレジットカード'/)
  assert.match(sheet,/value:'prepaid',label:'プリペイドカード'/)
  assert.match(sheet,/value:'points',label:'ポイント払い'/)
  assert.match(sheet,/canEditClosing=computed\(\(\)=>isEdit.value&&!isSpecial.value&&sourceType.value==='standard'\)/)
  assert.match(sheet,/期首残高は「残高」で設定できます/)
  assert.doesNotMatch(sheet,/v-model(?:\.number)?="openingBalance"/)
  assert.match(sheet,/payload\.expected=\{/)
  assert.match(sheet,/payload\.closingDay=closingDay\.value==='末日'\?0:Number\(closingDay\.value\)/)
})

test('submit occurs once and there is no API write on selection or cancellation',()=>{
  assert.match(sheet,/@submit\.prevent="save"/)
  assert.match(sheet,/await props\.onSave\(payload\)/)
  assert.match(sheet,/await props\.onDanger\(action,name\)/)
  assert.match(finance,/props\.api\(payload\.mode==='add'\?'payment-sources':'payment-sources\/update'/)
  assert.match(finance,/async function saveCardFromSheet\(payload\)/)
  assert.match(finance,/if\(payload\.mode==='edit'&&name!==currentName\)/)
  assert.doesNotMatch(sheet,/props\.api\(|fetch\(/)
  assert.match(sheet,/window\.confirm\('変更内容を破棄しますか？'\)/)
  assert.match(sheet,/window\.confirm\('未保存の変更を破棄して操作しますか？'\)/)
  assert.match(sheet,/emit\('close'\)/)
})

test('danger operations are tucked away, require confirmation and keep archival history',()=>{
  assert.match(sheet,/<details v-if="isEdit&&!isSpecial" class="card-editor-danger">/)
  assert.match(sheet,/アーカイブ/)
  assert.match(sheet,/完全削除/)
  assert.match(finance,/async function runCardDanger\(action,name\)/)
  assert.match(finance,/payment-sources\/archive/)
  assert.match(finance,/payment-sources\/remove/)
  assert.match(api,/有効な固定費で使用中のためアーカイブできません/)
  assert.match(api,/過去の明細・保存済み請求・固定費で使用中のため削除できません/)
})

test('mobile card sheet handles keyboard, focus, nested selectors and fixed footer',()=>{
  assert.match(sheet,/visualViewport\?\.addEventListener\('resize',syncViewport\)/)
  assert.match(sheet,/keyboardInset\.value=Math\.max/)
  assert.match(sheet,/document\.body\.style\.overflow='hidden'/)
  assert.match(sheet,/document\.querySelector\('\.mobile-choice-backdrop'\)/)
  assert.match(sheet,/nextTick\(\(\)=>closeButton\.value\?\.focus/)
  assert.match(sheet,/@keydown="trapFocus"/)
  assert.match(sheet,/class="card-editor-grab-area"/)
  assert.match(sheet,/if\(distance>75\)requestClose\(\)/)
  assert.match(sheet,/class="card-editor-footer"/)
  assert.match(sheet,/\.card-editor-footer\{display:grid;grid-template-columns:1fr 1fr/)
  assert.match(sheet,/padding:12px 16px max\(12px,env\(safe-area-inset-bottom/)
  assert.match(sheet,/\.card-editor-footer button\{[^}]*min-height:48px/)
  assert.match(sheet,/@media\(prefers-reduced-motion:reduce\)/)
})

test('edit endpoint batches updates with a shared concurrency guard for saved bills and ledger',()=>{
  const handler=api.split("if (a === 'payment-sources' && b === 'update' && m === 'POST') {")[1]
    ?.split("if (a === 'payment-sources' && b === 'rename' && m === 'POST') {")[0]||''
  assert.ok(handler)
  assert.match(handler,/await prepaidSchemaReady\(db\)/)
  assert.match(handler,/expected\.closingDay/)
  assert.match(handler,/is_archived/)
  assert.match(handler,/NOT EXISTS\(SELECT 1 FROM payment_sources WHERE name=\?1\)/)
  assert.match(handler,/NOT EXISTS\(/)
  assert.match(handler,/SELECT 1 FROM entries WHERE type='transfer'/)
  for(const t of ['merchant_rules','entries','recurring_plans','card_bills','payment_sources']){
    assert.match(handler,new RegExp('UPDATE '+t))
  }
  assert.match(handler,/const result=await db\.batch\(statements\)/)
  assert.match(handler,/if\(!result\.at\(-1\)\?\.meta\?\.changes\)/)
  assert.match(handler,/return json\(\{error:'カード設定が更新されています。再読み込みしてください'\},409\)/)
})
