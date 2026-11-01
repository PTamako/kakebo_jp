import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8')
const portfolio = read('src/SbiPortfolio.vue')
const transfers = read('src/InvestmentTransferReview.vue')
const prepaid = read('src/PrepaidAssets.vue')
const api = read('functions/api/prepaid-assets.js')

test('investment plan title and add button share one centered row and only one section divider',()=>{
  assert.match(portfolio,/class="sbi-manage-subhead"/)
  assert.match(portfolio,/class="sbi-manage-subhead">\s*<strong>積立設定<\/strong>\s*<button[^>]*@click="editPlan\(null\)"/)
  assert.match(portfolio,/\.sbi-manage-subhead\{display:flex;align-items:center;justify-content:space-between;/)
  assert.match(portfolio,/\.sbi-manage-subhead>strong\{display:flex;align-items:center;/)
  assert.match(portfolio,/\.sbi-manage-subhead \.sbi-text-action\{display:inline-flex;align-items:center;justify-content:center;/)
  assert.match(portfolio,/\.sbi-management-body > \.sbi-manage-subhead \+ \.sbi-plan-row\{border-top:0\}/)
  assert.match(portfolio,/\.sbi-transfer-disclosure\{[^}]*border-top:1px solid var\(--line\)/)
  assert.match(portfolio,/\.sbi-transfer-content\{[^}]*border-top:0;/)
  assert.match(portfolio,/\.sbi-transfer-content > \.sbi-transfer-row:first-of-type\{border-top:0\}/)
  assert.match(portfolio,/\.sbi-transfer-summary\{display:grid;grid-template-columns:minmax\(0,1fr\) auto 16px;align-items:center;/)
  for(const action of ['editPlan(p)','editingTransfer=t.id;newPurchaseMonth=t.effective_month'])
    assert.ok(portfolio.includes(action),action+' retained')
})

test('transfer reminder has a full-width safe title, no duplicate rule, and preserves actions',()=>{
  assert.match(transfers,/\.investment-review-row\{[^}]*grid-template-columns:minmax\(0,1fr\) auto;/)
  assert.match(transfers,/\.investment-review-entry strong\{[^}]*overflow-wrap:anywhere;word-break:break-word/)
  assert.match(transfers,/\.investment-review-row:first-of-type\{border-top:0\}/)
  assert.match(transfers,/retryTransfer\(item\)/)
  assert.match(transfers,/dismissTransferReminder\(item\)/)
  assert.match(transfers,/@media\(max-width:370px\)/)
})

test('prepaid cards show current balance and compact monthly charge/usage totals',()=>{
  assert.match(prepaid,/class="wallet-list"/)
  assert.match(prepaid,/class="wallet-card-identity"/)
  assert.match(prepaid,/class="wallet-card-icon"/)
  assert.match(prepaid,/class="wallet-card-flow"/)
  assert.match(prepaid,/今月のチャージ/)
  assert.match(prepaid,/今月の利用/)
  assert.match(prepaid,/現在残高/)
  assert.match(prepaid,/money\(card.charged_month\)/)
  assert.match(prepaid,/money\(card.spent_month\)/)
  assert.match(prepaid,/wallet-negative/)
  assert.match(prepaid,/\.wallet-name strong\{[^}]*overflow-wrap:anywhere/)
  assert.match(prepaid,/\.wallet-card-flow\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
  assert.match(prepaid,/\.wallet-row-actions\{display:grid;grid-template-columns:minmax\(0,1fr\) auto;/)
  assert.match(prepaid,/\.wallet-history-links button,\.wallet-edit\{[^}]*min-height:42px/)
  assert.match(prepaid,/@media\(max-width:370px\)/)
})

test('all prepaid routes, history navigation and opening-balance safety stay unchanged',()=>{
  assert.match(prepaid,/@click="emit\('open-history',card.name,'usage'\)"/)
  assert.match(prepaid,/@click="emit\('open-history',card.name,'charge'\)"/)
  assert.match(prepaid,/@click="startOpening\(card\)"/)
  assert.match(prepaid,/@click="emit\('open-card-settings'\)"/)
  assert.match(prepaid,/@click="refresh"/)
  assert.match(prepaid,/data\.cards\.slice\(0,2\)/)
  assert.match(prepaid,/prepaid-assets\/opening/)
  assert.match(api,/UPDATE payment_sources SET opening_balance=\?1/)
  assert.doesNotMatch(prepaid,/INSERT INTO|DELETE FROM|DROP TABLE/)
  assert.doesNotMatch(api,/UPDATE entries SET|INSERT INTO entries/)
})
