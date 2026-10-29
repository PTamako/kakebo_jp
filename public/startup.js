(() => {
  let shown = false;
  const showStartupError = (message) => {
    if (shown) return;
    shown = true;
    const panel = document.createElement('pre');
    panel.setAttribute('role', 'alert');
    panel.style.cssText = 'margin:16px;padding:16px;white-space:pre-wrap;overflow-wrap:anywhere;background:#fff0f0;color:#7b1f1f;border:1px solid #d99;border-radius:12px;font:14px/1.5 -apple-system,BlinkMacSystemFont,sans-serif;';
    panel.textContent = '家計簿を起動できませんでした。\n\n' + message + '\n\nこの画面をスクリーンショットして共有してください。';
    document.body.appendChild(panel);
  };
  window.addEventListener('error', (event) => {
    const detail = event.message || (event.target && (event.target.src || event.target.href)) || '読み込みエラー';
    showStartupError(String(detail));
  }, true);
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    showStartupError(String(reason && (reason.stack || reason.message) || reason || '未処理の非同期エラー'));
  });
  window.setTimeout(() => {
    const app = document.getElementById('app');
    if (app && !app.childElementCount) showStartupError('アプリの画面が描画されませんでした（JavaScript の起動または読み込みに失敗した可能性があります）。');
  }, 6000);
})();
