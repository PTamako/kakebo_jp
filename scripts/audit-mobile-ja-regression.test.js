import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')

test('iPhone PWA remains non-zoomable with full safe area and native-like tab targets',()=>{
  const html=read('index.html')
  const css=read('src/mobile-ui.css')
  assert.match(html,/maximum-scale=1, user-scalable=no, viewport-fit=cover/)
  assert.match(css,/safe-area-inset-bottom/)
  assert.match(css,/main \.bottom-nav button \{[\s\S]*?min-height: 55px/)
  assert.match(css,/main \.month-calendar \.calendar-day small \{[\s\S]*?font-size: clamp\(11px, 2\.9vw, 12px\)/)
  assert.match(css,/overflow-wrap: anywhere/)
  assert.doesNotMatch(html,/user-scalable=yes/)
})

test('selected month and legacy income categories always present natural Japanese',()=>{
  const stats=read('src/pages/StatisticsPage.vue')
  const app=read('src/App.vue')
  const ledger=read('src/pages/LedgerPage.vue')
  const finance=read('src/FinanceTools.vue')
  const api=read('functions/api/[[path]].js')
  assert.match(stats,/\{\{ monthLabel \}\}の支出合計/)
  assert.doesNotMatch(stats,/今月の支出合計|差引残高/)
  assert.match(stats,/収支差額/)
  assert.match(ledger,/選択解除|支出最多|収入最多/)
  assert.match(app,/const categoryLabel = name => categoryDisplayNames\.value\[name\] \|\| name/)
  assert.match(app,/INCOME_CATEGORIES\.value = sortOtherLast\(rows\.filter/)
  assert.doesNotMatch(app,/legacyCategoryLabels/)
  assert.match(finance,/最終更新：/)
  assert.match(finance,/@media \(max-width: 520px\)/)
  assert.doesNotMatch(api,/年份格式不正确/)
  // Database identifiers remain stable; this is display-only localization.
  assert.match(app,/const INCOME_CATEGORIES = ref\(\[\]\)/)
})

test('prepaid source transfers are subtracted from balance, excluded until due, and never self-charged',()=>{
  const api=read('functions/api/prepaid-assets.js')
  const formApi=read('functions/api/[[path]].js')
  const balance=read('src/finance-tools.js')
  const history=read('src/prepaid-history.js')
  assert.match(api,/transferred_out/)
  assert.match(api,/Number\(p\.spent\)-Number\(p\.transferred_out\)/)
  assert.match(balance,/balance=opening\+charged\+earned-spent-transferredOut/)
  assert.match(history,/entry\.type==='transfer' && entry\.payment_source===filter\.card/)
  assert.match(formApi,/同じプリペイドカードへの振替は登録できません/)
})
