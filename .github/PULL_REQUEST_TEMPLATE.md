# kakebo_jp リリース前チェック（GitHub Actions の無料枠消費なし）

> **重要**: 2026-11-12 から Pages / NAV Worker の自動 Preview は無効です。PR は GitHub Actions とローカルテストで検証します。Preview を本番 D1 で再開してはいけません。

## マージ前
- [ ] 変更先は本番 `main` ではなく専用ブランチ。変更ファイルと影響範囲を確認
- [ ] 最新 PR head の GitHub Actions `Validate` 成功（Node 回帰テスト fail 0、本番依存セキュリティ監査、Vite build）
- [ ] D1の変更がある場合、**先に**隔離DBにSQLを適用し互換性・実行計画を確認。本番で必要な移行はバックアップ後、デプロイ前に実施
- [ ] Preview 自動ビルドが無効で D1 バインディングが存在しないこと、本番 `DB` が `kakebo` のままであることを確認
- [ ] Preview を再有効化する場合は、別の隔離 D1・認証情報と書込み拒否テストを準備してから再開
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
