import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {filterJapaneseChoices} from '../src/japanese-choice-search.js'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const finance=read('src/FinanceTools.vue')
const panel=read('src/MobileMerchantRulesPanel.vue')
const mobile=read('src/mobile-ui.css')

test('店舗ルール管理 launches a bottom sheet instead of expanding a long page',()=>{
  assert.match(finance,/<MobileMerchantRulesPanel v-show="managementTab === 'tools'"/)
  assert.match(finance,/:rules="merchantRulesCombined"/)
  assert.match(finance,/:on-save="saveMerchantRule"/)
  assert.doesNotMatch(finance,/<details[^>]*merchant-rules-panel/)
  assert.match(panel,/class="merchant-sheet-launch-button"/)
  assert.match(panel,/<Teleport to="body">/)
  assert.match(panel,/role="dialog" aria-modal="true" aria-label="店舗ルール管理"/)
  assert.match(panel,/class="merchant-sheet-search"/)
  assert.match(panel,/placeholder="店舗名・カテゴリ・カードを日本語で検索"/)
  assert.match(panel,/class="merchant-sheet-row"/)
  assert.match(panel,/class="merchant-sheet-editor"/)
  assert.match(panel,/<MobileChoiceSheet v-model="category"/)
  assert.match(panel,/<MobileChoiceSheet v-model="payment"/)
  assert.match(panel,/変更を保存/)
  assert.match(panel,/filterJapaneseChoices/)
  assert.match(panel,/limit\+=8/)
  assert.match(panel,/document\.body\.style\.overflow='hidden'/)
  assert.match(panel,/nextTick\(\(\)=>trigger\.value\?\.focus/)
  assert.match(panel,/padding-bottom:env\(safe-area-inset-bottom/)
  assert.match(panel,/min-height:60px/)
  assert.match(mobile,/main \.finance-tools \.finance-disclosure \{ display: block; \}/)
})
test('merchant saved edits validate and update only remembered rules, preserving ledger entries',()=>{
  const match=finance.match(/async function saveMerchantRule\([^)]*\)\{([\s\S]*?)\n\}\nasync function changeCategoryRule/)?.[1]||''
  assert.ok(match,'explicit merchant Save handler should exist')
  assert.match(match,/original\.category!==oldCategory\|\|original\.payment_source!==oldPayment/)
  assert.match(match,/props\.api\('rules'/)
  assert.match(match,/props\.api\('custom-rules\?keyword='/)
  assert.match(match,/props\.api\('merchant-payment-rules'/)
  assert.match(match,/emit\('merchant-rules-changed'\)/)
  assert.doesNotMatch(match,/entries|ledger-updated|DELETE FROM/)
  assert.match(panel,/saving\.value=true;error\.value=''/)
  assert.match(panel,/if\(saving\.value\)return/)
})
test('Japanese rule search accepts kana variants and remains local to browser',()=>{
  const rows=[{label:'テスト商店 日用品 楽天カード',keywords:['テスト商店','日用品','楽天カード']}]
  assert.equal(filterJapaneseChoices(rows,'ﾃｽﾄ').length,1)
  assert.equal(filterJapaneseChoices(rows,'てすと').length,1)
  assert.equal(filterJapaneseChoices(rows,'存在しない').length,0)
  assert.doesNotMatch(panel,/fetch\(|localStorage|indexedDB|sessionStorage/)
})
