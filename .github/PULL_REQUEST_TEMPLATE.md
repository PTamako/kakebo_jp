# kakebo_jp リリース前チェック（GitHub Actions の無料枠消費なし）

> **重要**: Cloudflare Pages の Preview ビルドはPRを作る前でも自動起動しますが、GitHub の有料ブランチ保護がない場合は「成功するまでマージしない」手順の徹底が必要です。GitHub の Merge ボタン自体を技術的にブロックするものではありません。

## マージ前
- [ ] 変更先は本番 `main` ではなく専用ブランチ。変更ファイルと影響範囲を確認
- [ ] Cloudflare Pages の **Preview** デプロイを確認。PRの最新 head SHA と Preview のコミットが**完全一致**し、`deploy: success` になっている
- [ ] Preview ビルドの `npm run build` で Node 回帰テスト **fail 0**、本番依存のセキュリティ監査および Vite build が成功
- [ ] D1の変更がある場合、**先に**隔離DBにSQLを適用し互換性・実行計画を確認。本番で必要な移行はバックアップ後、デプロイ前に実施
- [ ] Preview `DB` は `kakebo_preview`、Production `DB` は `kakebo` を確認（同じIDなら中止）
- [ ] Preview の認証は本番と別のシークレット。Preview財務APIの書込みがHTTP 403で拒否されることを確認
- [ ] 同名固定費、Suica残高、OCRの実例、PWA画面の影響範囲に応じた確認
- [ ] Workers Cronのコードに差分がある場合、既存 `kakeibo-nav-sync` のみ更新される設計であることとCron4件を確認

## マージ後
- [ ] Cloudflare Pages **Production** の成功と最新main SHAを確認
- [ ] Worker変更がある場合、Worker版・D1バインディング・Cron時刻を確認
- [ ] Workerの次回ログで成功・失敗を確認。単にデプロイ成功しただけでは「実行成功」と報告しない
- [ ] iPhone Safari/PWAで画面と主要処理を確認（自動テストだけでは実機動作を保証しない）

## 原則
- 本番D1の再初期化、既存記帳・775分類規則・SBI保有データの上書きは禁止
- Previewで実財務データを使用しない。書込み検証はインメモリSQLiteまたは隔離テストハーネスで行う
- `AUTH_TOKEN`、APIトークン等をコミット・コメント・ログに記載しない
