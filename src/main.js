import { createApp, nextTick } from 'vue'
import App from './App.vue'

function showStartupError(error, phase = 'Vue') {
  const root = document.getElementById('app')
  if (!root || root.querySelector('[data-startup-error]')) return

  const panel = document.createElement('pre')
  panel.dataset.startupError = 'true'
  panel.setAttribute('role', 'alert')
  panel.style.cssText = 'margin:16px;padding:16px;white-space:pre-wrap;overflow-wrap:anywhere;background:#fff0f0;color:#7b1f1f;border:1px solid #d99;border-radius:12px;font:14px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;'
  const detail = error instanceof Error ? (error.stack || error.message) : String(error ?? '原因不明のエラー')
  panel.textContent = '家計簿の起動に失敗しました。\n\n発生箇所: ' + phase + '\n' + detail + '\n\nこの画面をスクリーンショットして共有してください。'
  root.replaceChildren(panel)
}

try {
  const app = createApp(App)

  // Vue catches template/render errors internally, so window.onerror alone
  // cannot expose them. Render the actual error instead of leaving a blank page.
  app.config.errorHandler = (error, instance, info) => {
    console.error('[家計簿 startup]', info, error)
    showStartupError(error, info || 'Vue')
  }

  app.mount('#app')

  nextTick(() => {
    const root = document.getElementById('app')
    if (root && !root.childElementCount) {
      showStartupError('Vue アプリを mount しましたが、画面要素が生成されませんでした。', 'mount')
    }
  })
} catch (error) {
  console.error('[家計簿 startup]', error)
  showStartupError(error, 'createApp / mount')
}
