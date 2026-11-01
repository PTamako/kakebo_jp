# SBI NAV 毎日自動更新（既存 D1 を使用）

既存の D1 `kakeibo` と `fund_prices` を使用します。NAV 同期のために新規テーブルやデータ移行は必要ありません。売買注文、保有口数、取得金額、取引明細は自動変更しません。

## 基準価額の提供範囲と検証

- MUFG 公式 API: https://www.am.mufg.jp/assets/pdf/tool/webapi/fund_api.pdf
- 固定 HTTPS エンドポイント: `https://developer.am.mufg.jp/fund_information_latest/association_fund_cd/{code}`
- 既知の公式対応銘柄：`0331418A`（オール・カントリー）、`03311187`（S&P500）、`0331A172`（先進国債券）。
- 新しく追加した銘柄は、画面から公式 API へ読み取り専用の照会を行い、銘柄コード一致・正の基準価額・有効な基準日を確認できた場合のみ「自動取得対象」と表示します。通信障害は「手動のみ」と誤判定しません。
- Cron はその時点の `investment_holdings` から最大 100 件の銘柄コードを読みます。公式 API から有効な値を取得できた銘柄のみ条件付きで `fund_prices` を更新します。
- `04317188`（iFreeNEXT NASDAQ100）は大和アセットマネジメント商品で、上記の MUFG API 対象外として手入力を維持します。画面の HTML や SBI/Yahoo の非公式スクレイピングは使用しません。
- 古すぎる日付、未来日、銘柄コード不一致、異常値、通信エラーでは価格を書き込みません。既存の有効な基準日と同日または古い値では巻き戻しません。
- 手入力 API は未来日の基準価額を拒否します（未来日の手動価格が Cron 更新を長期間妨げることを防止）。

## デプロイ方法

このスケジュールは **Cloudflare Pages とは別の既存 Worker `kakeibo-nav-sync` 1つ** で実行します。NAV 更新と毎週・毎月の固定費自動記帳を Cron 時刻別に振り分けます。新しい Worker を追加しません。

Cloudflare Workers Builds で自動デプロイする場合：

| 項目 | 設定 |
| --- | --- |
| Worker 名 | `kakeibo-nav-sync` |
| GitHub | `PTamako/kakebo_jp` |
| Production branch | `main` |
| Root directory | リポジトリのルート |
| Build command | 空欄 |
| Deploy command | `npx wrangler deploy --config wrangler.nav.toml` |
| Preview builds | 無効を推奨（本番 D1 を参照するため） |

この連携を有効にした後は `main` 更新時に NAV Worker が再デプロイされます。GitHub Actions は利用しません。
**ルートの `wrangler.toml` は Pages 用なので、Worker 名へ変更しないでください。** NAV Cron は `wrangler.nav.toml` を使います。

手動で再デプロイする場合（Cloudflare 認証済みの端末・Codespaces など）：

```bash
npm ci
npm run deploy:nav
```

いずれの方法でも Worker 設定と D1 バインディングを確認してください。Cron は固定費の **日本時間00:30（UTC前日15:30）** `30 15 * * *`、**09:30（UTC00:30）** `30 0 * * *` と、従来のNAV **日本時間21:00（UTC12:00）** `0 12 * * *`、**23:15（UTC14:15）** `15 14 * * *` の4件です。NAV は21:00に照会、23:15は未取得のMUFG銘柄だけ条件付き再確認します。固定費は予定日当日だけ登録し、同じ予定日の重複を防止します。大和の試験取得は HTTP 403 のため停止しています。2026-10-30 21:15 の再実行で対象3銘柄の更新成功（failed: []）を確認後、元の時刻に復帰しました。設定は Cloudflare Dashboard → Workers & Pages → `kakeibo-nav-sync` → Triggers で確認できます。

## 稼働確認と安全上の注意

デプロイ成功は定期ジョブ実行成功を意味しません。次回の Cron 実行後、Observability → Logs で `Recurring fixed-expense sync`（固定費）と `NAV sync`（基金）をそれぞれ確認し、`failed` の件数、更新対象銘柄、基準日を確認してください。基準価額の公表が21:00に間に合わない場合は23:15に条件付きで再照会し、それでも取得できない場合は既存値を保持します。

既存の `investment_holdings`、`investment_plans`、`entries`、移行済みの D1 テーブルを作り直したり、削除・再投入したりしないでください。ユーザー確認のない注文・約定・振替登録は行いません。



**自動記帳:** `recurring_plans.posting_mode='auto'` の予定だけ対象です。既存の固定費は手動のまま。停止・削除・月別/日別除外、既存の同名支出がある場合は登録を回避します。自動記帳は D1 内の記帳のみで、実際の決済は行いません。`0013` は事前に適用済みである必要があり、Cron 側では移行SQLを実行しません。

## 大和アセット NASDAQ100 の試験接続

- 対象は **04317188（iFreeNEXT NASDAQ100インデックス）だけ**。公式ファンド番号は **3373**。
- Workers の `DAIWA_CSV_EXPERIMENT=false` により現在は停止中。実験再開には公式の許諾された取得手段を確認してください。公式の 3373 詳細ページから「時系列データをダウンロード」のリンクを探し、同じ大和ドメインの CSV のみ取得します。対象リンクを発見できない、403 が返る、公式側のサイト変更がある場合は **取得できません**。未知の URL を推測してアクセスしません。
- CSV は Shift_JIS（CP932）または UTF-8 を読み、**基準日** と **基準価額**（分配金再投資基準価額ではない）を使用。公式ページのファンド名を照合した上で最新の日付と価格を検証します。
- 出典確認ができない場合は旧値・手入力を保持し、`optionalFailed` として診断ログに記録。MUFG 3 銘柄は通常通り更新し、Daiwa の失敗だけで Cron 全体を失敗扱いにしません。
- 23:15 の再試行は MUFG の未更新銘柄だけを対象とし、当日分の公式基準価額がある銘柄や土日はスキップします。大和の取得は実行しません。
- **重要：公式 CSV の固定 URL と Worker からの到達性は未検証です。このコードは本番での取得成功を保証しません。** 自動取得が確認できるまでは画面で「手動入力」と表示します。大和公式が自動アクセスを拒否する場合は頻繁な再試行や回避を行わず、この実験を停止してください。利用条件の確認も必要です。
- 手動で無効化するには Worker 側の `DAIWA_CSV_EXPERIMENT` を `false` に設定して再デプロイしてください。
