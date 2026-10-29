# 记账本（Vue3 + Cloudflare Pages + D1，PWA）

文字/图片 → 识别日期、时间、金额 → 自动分类 → 月度统计。全部在 Cloudflare 免费额度内，图片 OCR 在手机浏览器本地完成。

## 部署（约 10 分钟）
1. `wrangler.toml` 里把 `database_id` 换成你的 D1 ID（`database_name` 要和 D1 名一致）。
2. 建表（只需一次）：
   `npm i && npx wrangler login && npx wrangler d1 execute kakeibo --remote --file=schema.sql`
3. 推到 GitHub。
4. Cloudflare → Workers & Pages → Create → Pages → Connect to Git，选这个仓库：
   Build command `npm run build`，Output directory `dist`。
5. 项目 Settings → Variables and Secrets 添加 `AUTH_TOKEN`（自己设一个长口令，防止别人读写你的账）。
   （D1 绑定已写在 wrangler.toml 里；若面板里没显示，到 Settings → Bindings 手动加 `DB`。）
6. 手机 Safari/Chrome 打开网址 →「添加到主屏幕」。首次打开会提示输入口令。

## 本地开发
`npm run cf:dev`（构建后用 wrangler 在本地跑 Pages + D1）。

## 说明
- 默认识别规则在 `functions/api/[[path]].js`，识别不到时默认归入「日用品」。
- 可在「记一笔」新增自定义分类；分类保存在 D1 中，刷新后仍会保留。
- 每笔记录可勾选「将此商家绑定到所选分类，下次自动识别」，保存后会把商家 → 分类写入 D1 规则表；后续小票和文字录入会优先匹配较长、更具体的关键词。
- OCR（Tesseract.js）对日文小票不是 100% 准，所以识别后一定会让你确认再保存。

## 重要：既存データと検証
- 既存の本番 D1 で `schema.sql` を再実行して初期化しないでください。移行準備と安全な確認手順は [migrations/README.md](migrations/README.md) を参照してください。
- 本番/Preview は異なる D1 が必要です。検証していない Preview API は 503 で停止し、検証済みでも財務変更は 403 で禁止します。Cloudflare ダッシュボードで Preview バインディングを確認してください。
- バックアップ JSON v3 は新規エクスポートに SHA-256 検証情報が含まれます。古い v1/v2/v3 は引き続き読み込めます。画像は含まれず、復元処理はまだ全表を一括ロールバックするトランザクションではありません。
- 本番リリース前の手動確認：`npm ci && npm run verify:release`（全テスト＋ビルド＋本番依存の High 以上の監査）。GitHub Actions の自動起動は予算制限のため無効、必要に応じて手動実行してください。
- 既存の取引・カスタム分類・SBI 評価額は初期化/自動再計算しません。実機 Safari、独立 D1 による復元、Cloudflare デプロイ結果は個別に確認してください。
