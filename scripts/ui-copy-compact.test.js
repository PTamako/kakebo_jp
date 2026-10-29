import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8')
const app = source('src/App.vue')+'\n'+source('src/pages/LedgerPage.vue')+'\n'+source('src/pages/StatisticsPage.vue')+'\n'+source('src/pages/AssetsPage.vue')+'\n'+source('src/SbiPortfolio.vue')
const finance = source('src/FinanceTools.vue')
const form = source('src/TransactionForm.vue')

test('管理・その他: backup description is compact but still discloses local receipts excluded', () => {
  assert.match(finance, /帳簿・設定をJSON保存（レシート画像は対象外）/)
  assert.doesNotMatch(finance, /全明細・SBI評価額と損益・固定支出・カード設定・通知状態をJSONで保存します/)
  assert.match(finance, /既存データは保持/)
  assert.match(finance, /バックアップを選び直してください/)
  assert.match(finance, /if\(!confirm\(descriptions/)
})
test('management controls keep irreversible image-clear warning and retain D1 ledger', () => {
  assert.match(finance, /画像は復元できません。明細・SBI評価額は残ります/)
  assert.match(finance, /画像は対象外/)
  assert.match(finance, /端末保存・30日/)
  assert.match(finance, /明細は残ります/)
  assert.match(source('src/receipt-store.js'), /const TTL = 30 \* 24 \* 60 \* 60 \* 1000/)
})
test('remove redundant visual helper paragraphs without changing chart labels or chart logic', () => {
  assert.doesNotMatch(app, /<p class="trend-note"><\/p>/)
  assert.doesNotMatch(app, /何にお金を使ったか確認しましょう|月ごとの年間収入の推移/)
  assert.match(app, /支出 ÷ 収入 · 破線：80% \/ 100%/)
  assert.match(app, /150%超は上端に表示/)
  assert.match(app, /期日で家計簿に反映。SBIへの着金確認・買付は別です/)
  assert.match(app, /基準価額は三菱UFJ運用の3銘柄を自動更新します。/)
})
test('input and OCR keep short actionable explanations and AI image disclosure', () => {
  assert.match(app, /Cloudflare AIに画像を送信/)
  assert.match(app, /回数上限≠料金上限/)
  assert.match(app, /画像は端末内に30日保存/)
  assert.match(form, /<span>反映日<\/span>/)
  assert.match(form, /選択済み/)
})
