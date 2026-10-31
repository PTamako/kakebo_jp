import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NOTIFICATION_DURATION, notificationLevel } from '../src/notifications.js'

const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8')
const app = read('src/App.vue')
const finance = read('src/FinanceTools.vue')
const sbi = read('src/SbiPortfolio.vue')
const wallet = read('src/PrepaidAssets.vue')
const toast = read('src/GlobalToast.vue')
const source = read('src/notifications.js')

test('global toast lasts exactly 3 seconds; a new operation resets its timer', () => {
  assert.equal(NOTIFICATION_DURATION, 3000)
  assert.equal(notificationLevel('記録を保存しました'), 'success')
  assert.equal(notificationLevel('保存に失敗しました'), 'error')
  const pending = new Map()
  let next = 0
  const setTimeoutFake = (fn,ms)=>{const id=++next;pending.set(id,{fn,ms});return id}
  const clearTimeoutFake = id=>pending.delete(id)
  const module = new Function('shallowRef','setTimeout','clearTimeout',
    source.replace("import { shallowRef } from 'vue'", '')
      .replace(/^export /gm,'') +
    '\nreturn {notification,notify,clearNotification,NOTIFICATION_DURATION}')
      (value=>({value}),setTimeoutFake,clearTimeoutFake)
  module.notify('保存しました')
  assert.equal(module.notification.value.text,'保存しました')
  assert.equal([...pending.values()][0].ms,3000)
  module.notify('削除に失敗しました')
  assert.equal(module.notification.value.level,'error')
  assert.equal(pending.size,1,'old timer was cancelled')
  const id=[...pending.keys()][0]
  const fired = pending.get(id).fn
  pending.delete(id) // A real timer leaves the scheduler when it fires.
  fired()
  assert.equal(module.notification.value,null)
  module.notify('もう一度成功')
  module.clearNotification()
  assert.equal(module.notification.value,null)
  assert.equal(pending.size,0)
})

test('global notification floats above all screens, is non-blocking and accessible', () => {
  assert.match(app,/<GlobalToast \/>/)
  assert.match(app,/const flash = t => \{ notify\(t\); msg\.value = '' \}/)
  assert.doesNotMatch(app,/class="toast" role="status"/)
  assert.match(toast,/position:fixed;inset:0;z-index:9999/)
  assert.match(toast,/display:flex;align-items:center;justify-content:center/)
  assert.match(toast,/width:fit-content;max-width:min\(380px,100%\);min-width:0/)
  assert.match(toast,/\.global-toast-message span\{[\s\S]*?min-width:0;max-width:100%/)
  assert.match(toast,/white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word/)
  assert.match(toast,/max-width:100%;padding:13px 14px;font-size:13px/)
  assert.match(toast,/overflow-x:hidden;overflow-y:auto/)
  assert.match(toast,/NOTIFICATION_DURATION = 3000|global-toast-message/)

  assert.match(toast,/pointer-events:none/)
  assert.match(toast,/:role="notification\.level === 'error' \? 'alert' : 'status'"/)
  assert.match(toast,/env\(safe-area-inset-top\)/)
})

test('management messages are dismissed after 3 seconds and do not stick at the page top',()=>{
  for(const name of ['cardMessage','recurringMessage','message','trashMessage',
      'duplicateReviewMessage','receiptImagePrivacyMessage','receiptExportMessage'])
    assert.match(finance,new RegExp('watch\\(field, value => \\{'),'transient watcher')
  assert.match(finance,/if \(field\.value === value\) field\.value = ''/)
  assert.match(finance,/}, NOTIFICATION_DURATION\)/)
  assert.match(finance,/onUnmounted\(\(\) => \{/)
  assert.doesNotMatch(finance,/<p v-if="cardMessage" role="status">/)
  assert.doesNotMatch(finance,/<p v-if="recurringMessage" role="status">/)
  assert.doesNotMatch(finance,/<p v-if="trashMessage" role="status">/)
  assert.match(finance,/message && message\.startsWith\('復元中 '\)/)
  assert.match(finance,/!loaded/)
})

test('SBI and prepaid outcomes use the same three-second toast',()=>{
  for(const component of [sbi,wallet]){
    assert.match(component,/import \{ notify, NOTIFICATION_DURATION \} from '.\/notifications\.js'/)
    assert.match(component,/notify\(value,/)
    assert.match(component,/}, NOTIFICATION_DURATION\)/)
    assert.match(component,/onUnmounted/)
  }
  assert.match(sbi,/for \(const status of \[error, notice, bulkInfo, bulkWarning\]\)/)
  assert.match(wallet,/for \(const status of \[error, notice\]\)/)
  assert.doesNotMatch(sbi,/<p v-if="notice" class="sbi-success"/)
  assert.doesNotMatch(wallet,/<p v-if="notice" class="wallet-success"/)
})

test('no database or settings migration is needed for notifications',()=>{
  assert.doesNotMatch(source,/localStorage|fetch\(|DB\.|sqlite|D1/)
  assert.doesNotMatch(toast,/localStorage|fetch\(|DB\.|sqlite|D1/)
})
