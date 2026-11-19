import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { aiDailyLimit, tokyoAiDay } from '../functions/api/ai-quota.js'

const source = p => readFileSync(new URL('../'+p,import.meta.url),'utf8')
const app = source('src/App.vue')+'\n'+source('src/EntryInputPage.vue')
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

test('original fixed-expense list is shared, with five entries per page and consistent actions',()=>{
   const list=source('src/OriginalFixedCostList.vue')
   const member=source('src/MemberFixedCosts.vue')
   assert.match(finance,/<OriginalFixedCostList\s/)
   assert.match(finance,/role="tablist" aria-label="固定費の種類"/)
   assert.match(member,/<OriginalFixedCostList :items=/)
   assert.match(list,/<details class="recurring-list-disclosure"/)
   assert.match(list,/登録済みの固定費/)
   assert.match(list,/v-model="query"/)
   assert.match(list,/v-model="filter"/)
   assert.match(list,/filtered.value.slice\(0,5\)/)
   assert.match(list,/@click="emit\('edit',p\)"/)
   assert.match(list,/@click="emit\('toggle',p\)"/)
   assert.match(list,/@click="emit\('remove',p\)"/)
   assert.match(finance,/postApprovedRecurringEntries\(props.api,safe\)/)
 })
