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
