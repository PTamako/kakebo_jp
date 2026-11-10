import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/FinanceTools.vue', import.meta.url), 'utf8')
const creation = source.match(/<div v-if="cardMode === 'add'"[\s\S]*?(?=\n    <div v-if="cardMode === 'edit')/)?.[0] || ''

test('card creation has its own single-column form, not the card icon toolbar grid', () => {
  assert.match(creation, /class="card-editor card-add-editor"/)
  assert.doesNotMatch(creation, /class="finance-inputs card-controls"/)
  assert.match(source, /\.card-add-editor\{display:grid;grid-template-columns:minmax\(0,1fr\)/)
  assert.match(creation, /class="card-add-field">名称/)
  assert.match(creation, /class="card-add-field">種類/)
})

test('card creation uses one cancel control and no redundant header or close icon', () => {
  assert.doesNotMatch(creation, /card-add-heading|card-add-close|追加を閉じる/)
  assert.doesNotMatch(source, /\.card-add-heading|\.card-add-close/)
  assert.match(creation, /role="group" aria-label="カードを追加"/)
  assert.match(creation, /class="card-add-cancel"[^>]*@click="cardMode = ''"/)
  assert.match(source, /\.card-add-editor\{[^}]*gap:8px;[^}]*padding:10px 12px 12px/)
  assert.match(source, /\.finance-panel \.card-add-actions button\{[^}]*min-height:44px/)
})

test('save and cancel use two equal-width mobile action columns', () => {
  assert.match(creation, /class="card-add-actions"/)
  assert.match(source, /\.card-add-actions\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
  assert.match(source, /\.finance-panel \.card-add-actions button\{[^}]*white-space:nowrap/)
  assert.match(creation, /class="card-add-cancel"[^>]*>キャンセル/)
  assert.match(creation, /class="card-add-save"[^>]*@click="addPaymentSource"/)
  assert.match(creation, /:disabled="busy \|\| !newPaymentSource\.trim\(\)"/)
})

test('both card types remain available and prepaid remains linked to assets', () => {
  assert.match(creation, /value="standard">クレジットカード/)
  assert.match(creation, /value="prepaid">プリペイドカード/)
  assert.match(creation, /期首残高は「残高」で設定できます。/)
})

test('switching cards immediately refreshes the editor name and card type', () => {
  assert.match(source, /watch\(selectedCard, \(name\) => \{[\s\S]*?editedCardName\.value = name \|\| ''[\s\S]*?editSourceType\.value = selectedSourceType\.value[\s\S]*?\}, \{ flush: 'sync' \}\)/)
  assert.match(source, /watch\(selectedSourceType, \(type, previousType\) => \{[\s\S]*?editSourceType\.value = type/)
  assert.match(source, /v-if="cardMode === 'edit' && selectedCard" :key="selectedCard"/)
  assert.match(source, /:key="selectedCard \+ '-closing-day'"/)
  assert.match(source, /const selectedSourceType = computed\(\(\) => props\.paymentSourceMeta\[selectedCard\.value\]/)
})

test('closing day only appears for an actual credit card, never cash, other or prepaid', () => {
  assert.match(source, /const isCreditCard = name => [^\n]*!\['現金','その他','其他'\]\.includes\(name\)[^\n]*source_type === 'standard'/)
  assert.match(source, /v-if="isCreditCard\(selectedCard\) && editSourceType === 'standard'">締め日/)
  assert.match(source, /:model-value="closingDayFor\(selectedCard\)"/)
  assert.match(source, /@change="saveClosingDay\(selectedCard,\$event\)"/)
})

test('card editing keeps Save, Close, Archive and Delete on one mobile row', () => {
  const actions=source.match(/<div class="finance-inputs card-edit-actions"[\s\S]*?<\/div>/)?.[0] || ''
  assert.equal((actions.match(/<button\b/g)||[]).length,4)
  assert.match(actions,/class="card-edit-save"/)
  assert.match(actions,/class="card-edit-icon card-edit-close"/)
  assert.match(actions,/class="card-edit-icon card-edit-archive"/)
  assert.match(actions,/class="card-edit-icon card-edit-delete"/)
  assert.match(actions,/aria-label="閉じる"/)
  assert.match(actions,/aria-label="カードをアーカイブ"/)
  assert.match(actions,/aria-label="カードを完全削除"/)
  assert.match(actions,/@click="saveCardType"/)
  assert.match(actions,/@click="archivePaymentSource\(selectedCard\)"/)
  assert.match(actions,/@click="removePaymentSource\(selectedCard\)"/)
  assert.match(source,/\.finance-panel \.card-edit-actions\{display:flex;flex-wrap:nowrap;/)
  assert.match(source,/\.finance-panel \.card-edit-actions>\.card-edit-icon\{flex:0 0 44px;/)
  assert.match(source,/\.finance-panel \.card-edit-actions>button\{[^}]*min-height:44px/)
})
