import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const finance = readFileSync(new URL('../src/FinanceTools.vue', import.meta.url), 'utf8')
const notification = readFileSync(new URL('../src/notifications.js', import.meta.url), 'utf8')
const sbi = readFileSync(new URL('../src/SbiPortfolio.vue', import.meta.url), 'utf8')
const prepaid = readFileSync(new URL('../src/PrepaidAssets.vue', import.meta.url), 'utf8')

const calculatedTrash = () => {
  const definitions = finance.slice(
    finance.indexOf('const trashCountReady = computed('),
    finance.indexOf('const duplicateReviewMessage = ref(')
  )
  const state = {
    reviewStateReady:{value:true},
    reviewStateBusy:{value:false},
    reviewStateError:{value:''},
    settingsReady: {value:true},
    loaded:{value:true},
    busy:{value:false},
    transferTrashLoaded:{value:false},
    deletedPlanLoaded:{value:false},
    transferTrashLoading:{value:false},
    deletedPlanLoading:{value:false},
    reviewTrash:{value:{duplicateGroups:[],recurringExclusions:[{},{}],transferReminders:[]}},
    trashedRecurringPlans:{value:[]}
  }
  const computed = fn => ({get value(){return fn()}})
  const values = new Function('computed',...Object.keys(state),
    definitions + '\nreturn {trashCountReady,trashCount,trashCountLoading}'
  )(computed,...Object.values(state))
  return {state,values}
}

test('trash header never presents partial 2 before all three categories have finished loading', () => {
  const {state,values}=calculatedTrash()
  assert.equal(values.trashCountReady.value,false)
  assert.equal(values.trashCount.value,null,'must not show partial count 2')
  state.transferTrashLoaded.value=true
  state.reviewTrash.value.transferReminders=[{},{}]
  assert.equal(values.trashCount.value,null,'deleted plan fetch is still pending')
  state.deletedPlanLoaded.value=true
  assert.equal(values.trashCountReady.value,true)
  assert.equal(values.trashCount.value,4)
  state.reviewStateReady.value=false
  assert.equal(values.trashCountReady.value,false,'D1 review marker load must finish before showing count')
  assert.equal(values.trashCount.value,null)
  state.reviewStateReady.value=true
  assert.equal(values.trashCount.value,4)
  state.transferTrashLoading.value=true
  state.transferTrashLoaded.value=false
  assert.equal(values.trashCount.value,null,'invalidate total during refresh rather than showing 2')
  state.transferTrashLoading.value=false
  state.transferTrashLoaded.value=true
  assert.equal(values.trashCount.value,4)
  state.reviewTrash.value.transferReminders.pop()
  assert.equal(values.trashCount.value,3,'legitimate deletion must update total immediately')
  state.trashedRecurringPlans.value.push({id:'plan1'})
  assert.equal(values.trashCount.value,4,'newly removed recurring plan enters the count')
  state.settingsReady.value=false
  assert.equal(values.trashCount.value,null)
})

test('entering その他 prefetches transfer notices and deleted fixed expenses before bin opens',()=>{
  const handler=finance.match(/watch\(\[\(\) => props\.active, managementTab\], \(\[active,tab\]\) => \{([\s\S]*?)\n\}\)/)?.[1]
  assert.ok(handler)
  assert.match(handler,/if\(active && tab === 'tools'\)/)
  assert.match(handler,/void loadTransferTrash\(\)/)
  assert.match(handler,/void loadDeletedPlans\(\)/)
  assert.match(finance,/function onReviewTrashToggle\(event\)/)
  assert.match(finance,/if \(!event\.currentTarget\?\.open\) return/)
  assert.match(finance,/ledgerDirty \|\| !loaded\.value/)
})

test('trash heading, collapsed detail groups and empty state all require the complete count',()=>{
  assert.match(finance,/<summary>ゴミ箱 <span class="review-trash-count" aria-live="polite">/)
  assert.match(finance,/trashCountReady \? trashCount\+'件'/)
  assert.match(finance,/'確認中…'/)
  assert.match(finance,/<template v-if="trashCountReady">/)
  assert.match(finance,/v-if="trashCount === 0"/)
  assert.match(finance,/v-if="!trashCountReady && !trashCountLoading"/)
  assert.equal((finance.match(/class="review-trash-category"/g)||[]).length,4)
  assert.match(finance,/const trashCount = computed\(\(\) => trashCountReady\.value/)
})

test('a failed category load cannot show stale totals or permit emptying the trash',()=>{
  assert.match(finance,/deletedPlanLoaded\.value = false\s+try \{/)
  assert.match(finance,/transferTrashLoaded\.value = false\s+try \{/)
  assert.match(finance,/!transferTrashLoaded\.value \|\| !deletedPlanLoaded\.value/)
  assert.match(finance,/:disabled="recurringBusy \|\| trashBusy \|\| transferTrashLoading \|\| deletedPlanLoading \|\| !transferTrashLoaded \|\| !deletedPlanLoaded"/)
})

test('all global and component notification timers share exactly 3000 ms',()=>{
  assert.match(notification,/export const NOTIFICATION_DURATION = 3000/)
  assert.match(notification,/\}, NOTIFICATION_DURATION\)/)
  for (const component of [finance,sbi,prepaid]){
    assert.match(component,/import \{ notify, NOTIFICATION_DURATION \} from '.\/notifications\.js'/)
    assert.match(component,/\}, NOTIFICATION_DURATION\)/)
    assert.doesNotMatch(component,/\}, 5000\)/)
  }
})
