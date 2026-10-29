# SBI NAV 毎日自動更新（データベースの新設は不要）

既存D1の `fund_prices` テーブルを再利用。**新しいD1テーブルや追加SQLはありません。**

## ソースと提供範囲

- MUFG公式Web API: https://www.am.mufg.jp/assets/pdf/tool/webapi/fund_api.pdf
- エンドポイント: `https://developer.am.mufg.jp/fund_information_latest/association_fund_cd/{code}`
- `0331418A` オール・カントリー、`03311187` S&P500、`0331A172` 先進国債券は運用会社の公式APIで更新。
- `04317188` iFreeNEXT NASDAQ100は大和アセットマネジメント商品。自動取得可能な正式JSON APIを確認できていないため**まだ自動更新しません**。既存の手入力と保有額は維持します。サイトHTMLやYahoo/SBI画面の非公認スクレイピングは禁止。
- 実APIの出力構造と利用条件は運用環境でも確認し、失敗時は前回基準価額を残す。

## 初回デプロイ（1回のみ）

Cloudflare Pagesとは別の**専用Worker**を一度だけデプロイしてください。新DB作成、毎回コマンド実行は不要です。

```bash
npm ci
npm run deploy:nav
```

`wrangler.nav.toml` を使い、既存D1 `kakeibo` を結びます。毎日 **日本時間06:30（UTC21:30）** のCron Triggerを作成します。Cloudflare Dashboardの「Workers & Pages」→「kakeibo-nav-sync」→「Triggers」で設定を確認してください。

**注意**：Pages の Git 連携がデプロイするのは PWA であり、別Workerは自動デプロイされません。GitHubへのPRマージだけではCron Triggerを作成しません。Workerの初回公開が必要です。

## 正常時の挙動と安全性

- 現在DBに保有されているMUFG 3銘柄だけを取得し、公式APIレスポンスの銘柄コード・基準価額・基準日を検証する。
- 14日より古い価格、未来日、別の銘柄コード、異常な数量、エラーは保存しない。
- `fund_prices` の基準日が既存より新しい時のみ更新（初回SBI画面日だけ例外）。
- 過去/同日のデータや失敗レスポンスで既存価格を巻き戻さない。
- `investment_holdings` の保有口数/取得金額、`investment_plans`、`entries`、`investment_snapshots` には書き込まない。
- PWA の「資産・投資」画面は既存のGET APIから最新NAVと評価額を計算して表示。投資信託の買付・約定は自動登録しない。

本機能では価格履歴テーブルはまだ作成しません（依頼された追加の建表作業を避けるため）。必要になれば別の移行として検討します。
