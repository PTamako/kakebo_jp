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
  assert.match(creation, /期首残高は「資産」で設定できます。/)
})
