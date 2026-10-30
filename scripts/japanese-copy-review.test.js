import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const app=read('src/App.vue')
const finance=read('src/FinanceTools.vue')
const stats=read('src/pages/StatisticsPage.vue')
const wallet=read('src/pages/AssetsPage.vue')

test('main navigation and management tabs use concise, natural Japanese',()=>{
  assert.match(finance,/<h1 class="finance-heading">管理<\/h1>/)
  assert.match(finance,/>固定費<\/button>/)
  assert.match(finance,/>カード<\/button>/)
  assert.match(finance,/>積立<\/button>/)
  assert.match(finance,/>その他<\/button>/)
  assert.doesNotMatch(finance,/>固定支出<\/button>|管理・照合/)
})
test('monthly statistics use conventional Japanese category and yearly breakdown labels',()=>{
  assert.match(stats,/<h2>カテゴリ別支出<\/h2>/)
  assert.match(stats,/<h2>年間の収入内訳<\/h2>/)
  assert.match(stats,/<h2>年間の支出内訳<\/h2>/)
  assert.match(stats,/支出が最も多い月/)
  assert.match(stats,/収入が最も多い月/)
  assert.match(stats,/支出割合が最も高い月/)
  assert.doesNotMatch(stats,/年度カテゴリ収入|年度カテゴリ支出|月間最高支出|カテゴリ支出/)
})
test('short messages use 下書き / 記帳 and state the OCR payment selection plainly',()=>{
  assert.match(app,/下書きとして残ります/)
  assert.match(app,/読み取り対象のカード/)
  assert.doesNotMatch(app,/草稿として保存されます|今回の明細のカード/)
  assert.match(finance,/記帳前に内容を確認してください/)
  assert.match(finance,/毎月の記帳日/)
  assert.doesNotMatch(finance,/入帳前に確認してください|毎月の登録日/)
})
test('the wallet activity uses natural concise Japanese, without hard-coded card names or destructive data changes',()=>{
  assert.match(wallet,/最近の利用/)
  assert.match(wallet,/最近のチャージ/)
  assert.match(wallet,/latestUsage\.card/)
  assert.match(wallet,/latestCharge\.card/)
  assert.doesNotMatch(wallet,/latestUsage\.card==='Suica'|latestUsage\.card==='PASMO'/)
  // Only strings in the UI are changed. Stable internal category keys must not
  // be edited here because historical D1 entries rely on them.
  assert.match(app,/'工资'/)
  assert.match(app,/'其他收入'/)
  assert.match(finance, /'餐饮':'外食'/)
})
