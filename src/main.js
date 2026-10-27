import { createApp, nextTick } from 'vue'
import App from './App.vue'

function describeError(error) {
  const parts = []
  const seen = new Set()
  let current = error
  while (current && !seen.has(current) && parts.length < 4) {
    seen.add(current)
    if (current.message) parts.push(String(current.message))
    else if (typeof current === 'string') parts.push(current)
    if (current.stack && !parts.includes(current.stack)) parts.push(String(current.stack))
    current = current.cause
  }
  return parts.join('\n\n') || String(error ?? '原因不明のエラー')
}

function showStartupError(error, phase = 'Vue', info = '') {
  const root = document.getElementById('app')
  if (!root || root.querySelector('[data-startup-error]')) return

  const panel = document.createElement('pre')
  panel.dataset.startupError = 'true'
  panel.setAttribute('role', 'alert')
  panel.style.cssText = 'margin:16px;padding:16px;white-space:pre-wrap;overflow-wrap:anywhere;background:#fff0f0;color:#7b1f1f;border:1px solid #d99;border-radius:12px;font:14px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;'
  const component = info ? '\nコンポーネント情報: ' + info : ''
  panel.textContent = '家計簿の起動に失敗しました。\n\n発生箇所: ' + phase + component + '\n\n' + describeError(error) + '\n\nこの画面をスクリーンショットして共有してください。'
  root.replaceChildren(panel)
}

try {
  const app = createApp(App)
  app.config.errorHandler = (error, instance, info) => {
    console.error('[家計簿 startup]', info, error, error?.cause)
    showStartupError(error, 'Vue', info || '')
  }
  app.mount('#app')
  nextTick(() => {
    const root = document.getElementById('app')
    if (root && !root.childElementCount) {
      showStartupError('Vue アプリを mount しましたが、画面要素が生成されませんでした。', 'mount')
    }
  })
} catch (error) {
  console.error('[家計簿 startup]', error, error?.cause)
  showStartupError(error, 'createApp / mount')
}
