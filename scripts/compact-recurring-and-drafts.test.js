import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { aiDailyLimit, tokyoAiDay } from '../functions/api/ai-quota.js'

const source = p => readFileSync(new URL('../'+p,import.meta.url),'utf8')
const app = source('src/App.vue')
const finance = source('src/FinanceTools.vue')

test('20 daily AI OCR attempts by default, respecting lower admin restrictions',()=>{
  assert.equal(aiDailyLimit({}),20)
  assert.equal(aiDailyLimit({AI_OCR_DAILY_LIMIT:'20'}),20)
  assert.equal(aiDailyLimit({AI_OCR_DAILY_LIMIT:'30'}),20)
  assert.equal(aiDailyLimit({AI_OCR_DAILY_LIMIT:'3'}),3)
  assert.equal(aiDailyLimit({AI_OCR_DAILY_LIMIT:'0'}),0)
  assert.equal(aiDailyLimit({AI_OCR_DAILY_LIMIT:'invalid'}),20)
  assert.equal(tokyoAiDay(Date.UTC(2026,9,28,16,0,0)),'2026-10-29')
})

test('unsaved draft actions are compact, low emphasis and cannot touch saved entries',()=>{
  assert.doesNotMatch(app,/未保存の入力をこの端末から破棄|class="draft-clear"/)
  assert.match(app,/<button type="button" class="draft-discard-inline"[^>]*@click="clearLocalDraft"/)
  assert.match(app,/>\s*下書きを削除\s*<\/button>/)
  assert.match(app, /\.draft-discard-inline\{[^}]*min-height:44px;[^}]*background:transparent/)
  assert.match(app,/if\(!confirm\('未保存の下書きを削除しますか？保存済み明細やレシート画像は残ります。'\)\)return/)
  const fn=app.match(/function clearLocalDraft\(\) \{([\s\S]*?)\n\}/)?.[1]
  assert.ok(fn)
  assert.match(fn,/forms\.value=\[\];input\.value=''/)
  assert.match(fn,/await queueDeviceDraft\(tombstone\)/)
  assert.match(fn,/await queueDraftSave\(null\)/)
  assert.match(app,/api\('app-state\?key='\+DRAFT_KEY,\{method:'DELETE'\}\)/)
  assert.doesNotMatch(fn,/localStorage|deleteReceiptImage|clearAllReceiptImages|saveAll\(/)
})

test('fixed-expense list defaults to two entries, expands on demand and keeps actions intact',()=>{
  assert.match(finance,/<details class="recurring-list-disclosure">/)
  assert.match(finance, /登録済みの固定費 <strong>\{\{plans\.length\}\}件<\/strong>/)
  assert.match(finance, /今月予定額 \{\{yen\(recurringMonthlyTotal\)\}\}/)
  assert.match(finance, /v-model="recurringListQuery"/)
  assert.match(finance, /v-model="recurringListFilter"/)
  assert.match(finance, /const visibleRecurringPlans = computed\(\(\) => recurringListShowAll\.value \? filteredRecurringPlans\.value : filteredRecurringPlans\.value\.slice\(0, 2\)\)/)
  assert.match(finance, /watch\(\[recurringListQuery, recurringListFilter\], \(\) => \{ recurringListShowAll\.value = false \}\)/)
  assert.match(finance, /v-for="p in visibleRecurringPlans"/)
  assert.match(finance, /v-if="filteredRecurringPlans\.length > 2"[^>]*class="recurring-list-more"/)
  assert.match(finance, /recurringListShowAll \? '折りたたむ' : 'もっと見る'/)
  assert.doesNotMatch(finance, /class="recurring-list-count"/)
  assert.match(finance,/recurring-plan-toggle" :aria-expanded="expandedRecurringPlanId===p\.id"/)
  assert.match(finance, /v-if="expandedRecurringPlanId===p\.id"/)
  assert.match(finance, /@click="beginEditPlan\(p\)"/)
  assert.match(finance, /@click="togglePlanEnabled\(p\)"/)
  assert.match(finance, /@click="removePlan\(p\.id\)"/)
  assert.match(finance, /\.recurring-plan-scroll\{[^}]*max-height:320px;overflow-y:auto/)
  assert.match(finance, /\.recurring-plan-scroll\.is-expanded\{max-height:none;overflow:visible\}/)
  assert.match(finance, /\.recurring-candidate-list\{[^}]*max-height:240px;overflow-y:auto/)
  assert.doesNotMatch(finance, /<div v-for="p in plans" :key="p\.id" class="finance-row">/)
})
