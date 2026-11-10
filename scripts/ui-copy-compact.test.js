import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const app = source('src/App.vue')+'\n'+source('src/pages/LedgerPage.vue')+'\n'+source('src/pages/StatisticsPage.vue')+'\n'+source('src/pages/AssetsPage.vue')+'\n'+source('src/SbiPortfolio.vue')
const finance = source('src/FinanceTools.vue')
const form = source('src/TransactionForm.vue')

test('管理・その他: backup description explains JSON excludes private R2 receipts', () => {
  assert.match(finance, /JSONは帳簿のみ。ZIPにはR2と端末の画像を含めます/)
  assert.doesNotMatch(finance, /全明細・SBI評価額と損益・固定支出・カード設定・通知状態をJSONで保存します/)
  assert.match(finance, /既存データは保持/)
  assert.match(finance, /バックアップを選び直してください/)
  assert.match(finance, /if\(!confirm\(descriptions/)
})
test('management controls keep irreversible image-clear warning and retain D1 ledger', () => {
  assert.match(finance, /画像はZIPバックアップがないと復元できません。明細・SBI評価額は残ります/)
  assert.match(finance, /JSONは帳簿のみ/)
  assert.doesNotMatch(finance, /非公開R2で保管・自動削除なし/)
  assert.match(finance, /明細は残ります/)
  assert.doesNotMatch(source('src/receipt-store.js'), /const TTL = 30 \* 24 \* 60 \* 60 \* 1000/)
})
test('remove redundant visual helper paragraphs without changing chart labels or chart logic', () => {
  assert.doesNotMatch(app, /<p class="trend-note"><\/p>/)
  assert.doesNotMatch(app, /何にお金を使ったか確認しましょう|月ごとの年間収入の推移/)
  assert.match(app, /支出 ÷ 収入 · 破線：80% \/ 100%/)
  assert.match(app, /150%超は上端に表示/)
  assert.match(app, /期日反映は証券口座への入金・買付完了を保証しません/)
  // The duplicate NAV explanation was deliberately removed. Every holding
  // and the add/edit dialog show their own dynamic auto/manual sync status.
  assert.doesNotMatch(app,/基準価額の更新について|自動取得は対応銘柄のみ。保有口数・取得金額は手入力です。/)
  assert.match(app,/\{\{navModeLabel\(fund\.fund_code\)\}\}/)
  assert.match(app,/\{\{navModeLabel\(holding\.fundCode\)\}\}/)
  assert.match(app, /class="sbi-footnote"/)
})
test('input and OCR use the single short remaining-count label without pricing warnings', () => {
  assert.match(app, /本日のAI残り回数/)
  assert.doesNotMatch(app, /Cloudflare AIに画像を送信|回数上限≠料金上限|本日の共通AI残り|共通残り/)
  assert.match(app, /画像は非公開R2に保存（手動削除まで）/)
  assert.match(form, /<span>反映日<\/span>/)
  assert.match(form, /選択済み/)
})
