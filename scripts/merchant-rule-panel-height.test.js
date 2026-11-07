import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const finance=readFileSync(new URL('../src/FinanceTools.vue',import.meta.url),'utf8')
const mobile=readFileSync(new URL('../src/mobile-ui.css',import.meta.url),'utf8')

test('merchant rules collapsible card reuses the same sizing as other management cards',()=>{
  assert.match(finance,/<details v-show="managementTab === 'tools'" class="finance-panel finance-disclosure merchant-rules-panel">/)
  assert.match(finance,/<summary class="merchant-rules-summary"><span>店舗ルール管理<\/span><span class="merchant-rules-count">\{\{ merchantRulesCombined\.length \}\}件<\/span><\/summary>/)
  assert.match(mobile,/main \.finance-tools \.finance-disclosure \{ display: block; \}/)
  assert.match(mobile,/main \.finance-tools \.finance-disclosure > summary \{[^}]*min-height: 44px;/)
  assert.match(finance,/\.merchant-rules-panel>\.merchant-rules-summary>span:first-of-type\{[^}]*font-size:15px;/)
  assert.doesNotMatch(finance,/\.merchant-rules-summary::before\s*\{\s*content:/)
  assert.match(mobile,/main \.finance-tools \.finance-disclosure > summary::after/)
})
