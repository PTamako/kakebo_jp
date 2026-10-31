import { shallowRef } from 'vue'

// One global transient notification, regardless of which management tab or
// nested asset component initiated the action.
export const notification = shallowRef(null)
export const NOTIFICATION_DURATION = 5000
let timeoutId
let sequence = 0

export function notificationLevel(message) {
  return /失敗|できません|できない|エラー|中断|正しくありません|無効|確認してください|不足|拒否|取り消せません|読み込めません|保存できず|処理できず|未完了/.test(String(message)) ? 'error' : 'success'
}

export function notify(message, level) {
  const text = String(message ?? '').trim()
  if (!text) return
  if (timeoutId !== undefined) clearTimeout(timeoutId)
  notification.value = { id: ++sequence, text, level: level || notificationLevel(text) }
  timeoutId = setTimeout(() => {
    notification.value = null
    timeoutId = undefined
  }, NOTIFICATION_DURATION)
}

export function clearNotification() {
  if (timeoutId !== undefined) clearTimeout(timeoutId)
  timeoutId = undefined
  notification.value = null
}
