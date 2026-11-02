## 2026-11-02: 日本の平日（土日祝を除く）固定費（0014・適用必須）

**本番D1への追加SQL適用が終わるまでは、この機能のPRをmainへマージ／Pages・Workerへ反映しないでください。** 既存の読み取り・Workerも `workday_only` を使うため、未移行のままデプロイすると失敗します。

1. Cloudflare D1 本番DBでバックアップを取得してから、`migrations/0014_recurring_business_days.sql` の SQL を **1回だけ** 実行。既存の固定費・明細・除外は変更しません。
2. `PRAGMA table_info(recurring_plans);` で `workday_only` が存在することを確認。
3. PRのPages・SQLiteテスト成功後、mainへマージし、Pagesと元の `kakeibo-nav-sync` の両方の本番デプロイを確認。
4. 固定費の周期「平日（土日祝を除く）」を選び、カテゴリ「交通費」、支払方法「Suica」を指定し「自動記帳」で登録すると、日本の土日、祝日、振替休日、国民の休日を除く各日に支出明細を1件作成します。**現実のSuicaに対する決済は行いません。**
5. Suicaが「プリペイド」カードに設定されていれば、従来の残高計算（期首＋チャージ－支出－振替出金）にこの固定費が反映されます。翌日除外、当日の手動記帳、重複防止、ゴミ箱からの復元も日付単位で対応。勤務先独自の休業日は国民の祝日と異なるため、必要なら個別に除外。

既存 `schedule_type` のCHECK制約を壊さず、新しいフラグ `workday_only` で平日を表します。過去の行は全てデフォルト0のままです。

## 2026-11-02: 自動記帳した固定費を削除した時の再登録防止（追加SQLなし）

- 明細で自動/確認登録された固定費を削除するときは、既存の `recurring_candidate_exclusions`（月次）または `recurring_date_exclusions`（週次）にその回のスキップを記録し、明細をゴミ箱へ移す処理と同じD1トランザクションで確定する。
- 当日の後続Cronで復活せず、「未記帳分を確認」の候補にも表示されない。翌月・翌週の固定費スケジュールは継続する。
- ゴミ箱から復元すると、その削除操作で新たに追加したスキップだけを解除する。既存の利用者自身が設定した除外は維持する。
- 普通の手入力明細を削除しても固定費のスキップは増えない。**スキーマ変更・過去明細の移行・履歴データの再投入は不要。**

## 2026-11-02: 固定費の自動記帳・毎週／毎月の周期（0013・手動適用）

- まず本番 D1 の検証済みバックアップを取得し、別の D1 コピーでテストしてから、`migrations/0013_recurring_posting_mode.sql` を **一度だけ手動適用**。既存の `0001`～`0012` を再実行しない。
- `recurring_plans` に `posting_mode`（manual/auto、既存の固定費は必ず manual）、`auto_from_month`（過去分の自動補記を禁止）、`schedule_type`（monthly/weekly、既存は monthly）、`weekday`（0=日曜～6=土曜）を追加。週別に候補を除外する `recurring_date_exclusions` テーブルも追加する。既存データ・明細は変更しない。
- **順番:** (1) バックアップ (2) SQL 0013 を本番 D1 に一度だけ適用（適用済みなら再実行しない） (3) Pages コードをデプロイ (4) 既存の `kakeibo-nav-sync` を `npm run deploy:nav` または有効な Workers Builds で更新 (5) 同 Worker の NAV と固定費のログ・記帳結果を確認。新しい Worker は作成しない。
- 既存の `kakeibo-nav-sync` Worker は、固定費を毎日 **00:30 と 09:30 JST** に試行し、NAV を従来どおり 21:00 と 23:15 JST に確認する。毎月は指定日（月末を超える日付は末日）、毎週は指定した曜日にだけ登録する。既存明細と同名・同支払方法・同期間（月次は月、週次は日）があれば重複生成を防止する。1プラン1週の予定日を個別に記録し、同月内の別の週は妨げない。
- 停止中・ゴミ箱内・月別/日別除外済みのプランは自動記帳しない。新しく auto に設定したときは**その日を過ぎた過去の固定費を一括補記しない**。過去分は従来の「未記帳分を確認」でユーザーが確認・登録できる。
- 記帳方法・周期・曜日・有効開始月は D1 に保存され、iPhone の PWA を再インストールしても残る。JSON バックアップ/復元にも保存する。古いバックアップは monthly/manual を安全な既定値として使う。
- **0013 未適用のまま新しい Pages や Worker を公開しない。** 対象列・表がなく API が失敗する。API/Worker はマイグレーションや履歴投入を自動実行しない。
- 「自動記帳」は帳簿内の明細生成のみで、金融機関の引き落とし・送金ではない。

## 2026-10-31: 設定・下書きの D1 保存（0011・要手動適用）

- **0010 はすでに実行済みとして扱い、絶対に再実行しないでください。** 本番 D1 のコピーで確認してから、`migrations/0011_app_client_state.sql` **だけ** を本番へ一度適用します。もし `app_client_state` が既にあっても `CREATE TABLE IF NOT EXISTS` のため、既存データを変更しません。
- `app_client_state` は AI OCR 利用設定、為替換算の通貨、レシート画像の保存設定、保存前の下書き（画像本体を除く）を保管します。**テーマカラーは各端末の `localStorage` に保存し、D1 に書き込みません。**
- ログインは HttpOnly / Secure / SameSite=Strict Cookie と D1 の既存セッションテーブルで管理し、現在のタブの一時セッションだけ sessionStorage を利用します。
- 明細、既存の固定費、カード、SBI 投資信託、レシート画像を移動・補充・変更・削除しません。設定の GET/PUT は DDL や古いデータの自動投入を行いません。
- 0011 未適用で新しいコードを公開しないでください。アプリ設定・下書きの取得が 503 になり、UI が同期されません。

## 2026-10-31: 重複確認履歴の D1 保存（0010・適用済み）

- `migrations/0010_review_notice_states.sql` は **重複確認の状態だけ** を記録する `review_notice_states` テーブルを追加するものです。これはすでに本番 D1 に適用済みで、実行し直しません。
- 重複候補の「重複ではない」、ゴミ箱からの通知削除、固定費の月別除外・振替の通知確認を D1 に永続化します。**実際に記帳済みの明細は保持**されます。
- アプリ起動時、データ読み取り時にスキーマを作成したり、過去のローカルデータを再投入しません。
- 再インストールにより既に失われた旧 localStorage の確認履歴は復旧できません。更新後、一度だけ確認し直した通知は D1 に残ります。

## 2026-10-31: 登録済み固定費のゴミ箱（0009・要手動適用）

- **既存の本番D1に対して一度だけ** `migrations/0009_recurring_plan_trash.sql` を手動で適用する。過去の 0001–0008 を再実行しない。
- この移行は `recurring_plan_trash` テーブルの作成のみ。明細、既存の固定費、除外設定、SBI、請求データを変更しない。
- 0009 未適用でも、現在の固定費一覧と明細は読み取れる。ゴミ箱への移動はエラーで停止し、既存の固定費は削除しない。通常の固定費の記帳承認も旧来通り継続する。
- 適用後は、登録済み固定費の「削除」が論理削除になり、「管理 → その他 → ゴミ箱」から復元できる。ゴミ箱を空にするときだけ、再確認後に削除済み固定費の設定・その月別除外状態を完全削除する。**既に記帳済みの支出・資産移動は常に保持**。
- JSONバックアップには有効な `plans` と削除済みの `archivedPlans` を分けて格納する。復元先に同じ ID が既存の場合は既存設定を優先する。
- アプリ起動時や GET リクエストで DDL を自動実行しない。コピーD1で確認し、必要なバックアップを取ってから適用する。

## 2026-10-31: Fixed-expense candidates can be excluded per month

- 新しい D1 テーブル `recurring_candidate_exclusions` は **1つの固定費・1か月の候補の除外** だけを記録します。固定費の設定や既存の取引明細は削除しません。
- iPhone などでは未記帳候補を左にスワイプして「除外」、PC では「除外」ボタンを利用します。誤って除外した場合は「除外済み」から「元に戻す」を選択します。
- 候補一覧は「未記帳分を確認」で開き、「候補を閉じる」で閉じられます。
- JSON バックアップと復元も除外状態を保存・再現します。旧形式のバックアップは除外情報がなければ空として扱います。
- **本番へマージ／デプロイする前に** D1 のコピーで `migrations/0008_recurring_candidate_exclusions.sql` を試験してから、本番 D1 に **このファイルだけ** を一度適用してください。旧 `0001`～`0007` は再実行しないこと。API 起動や GET 処理は新しいテーブルを作りません。
- この変更では本番 D1 に SQL を実行していません。テーブル未適用の場合は除外操作を使用できず、固定費レビューがエラーを報告しますが、既存の明細自体は変更しません。

> **運用上の注意（2026-10-30）**：既存の本番 D1 データは移行済みです。過去の移行手順は履歴資料として保存されていますが、**再実行しないでください**。
> `migrations/0006_sbi_portfolio_linkage.sql` は履歴レコードの挿入を除去したスキーマ定義だけです。旧ブラウザカード設定と SBI スクリーンショットの初期投入 API は停止済み（410）。通常の画面操作は既存 D1 を読み取ります。
> 新しいカード・積立・記帳はユーザーの明示操作に限り追加し、バックアップ復元はユーザーの確認を必要とします。旧データの自動再投入・自動初期化は行いません。

> **2026-10-30 更新：本番D1への既存データ移行は完了済みとして扱います。** 以下は過去の移行記録であり、`0001`～`0007` を本番で再実行しないでください。特に `0006_sbi_portfolio_linkage.sql` は過去の初期持株・価格データの INSERT を削除し、定義のみの履歴SQLへ変更済みです。現行アプリは起動時・読取時に旧カードやSBI保有データを再投入しません。ユーザーが新規登録・記帳・バックアップ復元を明示的に実行したときのみデータを書き込みます。

# 当前运行规则（2026-10-29：数据与表迁移已经完成）

**以此节为准，下面保留的旧迁移说明仅作历史记录，不再适用于新版运行流程。**

- 生产 D1 已经完成表与数据迁移。API 只使用现有的 `merchant_rules`、`category_source`、`payment_sources`、`recurring_plans`、`card_bills` 和其他现行表。
- `/api/rules` 现在只读取 `merchant_rules` 中实际存在的分类关键词，不再把内置旧词典混入读取结果；空表不会自动补写。
- `schema.sql` 仅保留独立新库所需的 DDL，已删除规则和分类的默认 `INSERT`。该文件不得对已迁移生产 D1 重复执行。
- 旧关键词示例和历史 SBI 截图数据仅保存在 `scripts/fixtures/`，供内存数据库测试，不参与 Pages Functions 或 Worker 的生产运行；`migrations/0001`～`0007` 是历史资料，不在部署或日常 API 中执行。
- 业务性写入（用户确认的账本、卡片、备份恢复，以及定时基金官方基准价更新）继续按各自逻辑执行；不能把正常资产价格更新误认为旧数据初始化。

- 已移除 `functions/api/merchant-rules-store.js` 和 `functions/api/category-source-store.js`：不再从 `custom_rules`、`merchant_payment_rules`、`category_sort_order`、`category_icons`、旧 `rules` 向新表复制历史内容，也不在 GET 请求中补插分类、图标、商家关键词、排序或迁移标记。
- 不再在正常 API 请求中执行旧账本字段的 `ALTER TABLE`、支付结算日列的 `ALTER TABLE` 或旧版本兼容初始化。预期列缺失会报错，**不会自动重建或修改生产历史数据**。
- `schema.sql` 用于手动初始化全新独立数据库，不是已迁移生产 D1 的启动时脚本，也不应在生产库再次运行其中的初始化插入。
- 用户明确操作的新增/编辑/删除、JSON 备份恢复及资产移动照常写入新表；登录限流的 `login_attempts` 仍然保留使用。
- 旧迁移 SQL 与以下历史记录可保留供审计，但**禁止自动部署或在生产环境重新执行**。
- 本次仅修改代码/自动测试，不对 D1 线上数据运行迁移、补录或删除。

---

# D1 マイグレーション運用

本番 D1 に接続している API は現在、旧インストールの列不足を検出して互換的に追加します。安全な移行手順が検証されるまで**この処理を一度に削除しない**でください。

1. 本番のテーブル構成、件数、SBI の current_value / pnl、分類規則を読み取り専用で記録する。
2. 本番とは別の D1 複製を用意し、まず `migrations/0001_support_tables.sql` を複製で試す。
3. 対象 DB に `entries.type` / `payment_source` / `client_request_id` / `transfer_*` があるかを検査する。旧 DB には列が存在しない場合があるため、新規 schema.sql を既存 DB の全面移行と誤用しない。
4. 旧バックアップ v1 / v2 / v3 を複製に復元し、件数、SBI、ユーザー規則、固定支出を検証する。
5. 本番適用には別途承認が必要。現段階では旧 API の互換マイグレーションは維持する。

この PR では既存 D1 に SQL を実行していない。ファイルは段階的な移行の準備であり、本番移行完了の証明ではない。

## 新规则切换（2026-10-29）
- 旧内置 `rules` 行暂时保留在 D1 作为历史迁移资料，但 **不再参与自动分类**。API 返回由当前 `DEFAULT_RULE_ROWS` 和统一表 `merchant_rules` 中的非空 `category` 合成，用户分类优先。
- 不自动批量删除 `rules`，因为它还存储自定义类别 `__category__:` 和升级前无法完全区分的手动规则。所有历史 `entries.category` 保持原样。
- `migrations/0002_versioned_migration_tracking.sql` 只能在隔离 D1 副本演练后执行。正式迁移仍需检查数据库结构、SBI 快照和用户自定义规则。
- 大于 500 笔明细或 500 项设置的备份仍采用可恢复逐笔模式；小型备份使用 D1 单次 `batch()` 事务。不可宣称任意大小恢复均原子化。

## Preview 绑定验收
1. Cloudflare Pages Preview 环境中绑定名 `DB` 到专用 D1；生产 `DB` 必须为另外一个 UUID。
2. Preview variables 中明确配置 `APP_ENV=preview`、`PREVIEW_D1_ISOLATED=true`、`PREVIEW_D1_ID`、`PRODUCTION_D1_ID`，并核对两个 UUID 与实际绑定一致。
3. 缺少任何一个验真标记均返回 `503 preview_db_not_verified`。完成验真后 GET 可读取测试 D1，财务写入仍 `403 preview_read_only`。
4. 不要使用生产账户真实账目作为 Preview 测试数据；不要仅将不同 UUID 写在变量中就假定实际绑定完成。

## 发布验证
Cloudflare 构建执行 `npm run build`：Node 回归测试、`npm audit --omit=dev --audit-level=high`、Vite 生产构建。这样即使 GitHub Actions 配额暂不可用，高危/严重生产依赖告警仍阻止 Pages 构建。


## 2026-10-29: 新版增强与真实环境限制

- 生产请求中执行的一次性旧库兼容补列将记录 `schema_migrations.api-compat-v1`；以后优先查询此标记，跳过反复的列探测和索引 DDL。原有数据和分类不会被覆盖。**其他功能表的受控迁移仍需要独立验收**。
- 有条件的备份优先使用 `GET /api/backup-snapshot`：10 组 SELECT 在同一个 D1 `batch()` 读事务中执行，避免跨设备写入造成账本和设置读取时间不一致。如果交易数超过 10,000，则退回原有的双重核验备份方式。
- 大型恢复按最多 150 条明细分批执行 `POST /api/restore-atomic`。单批失败可以回滚该批；此前成功的批次保留，重试根据幂等请求 ID 去重。设置项超过 500 继续原有逐项恢复，整体不宣称跨多批原子。
- `migrations/0003_preview_d1_identity.sql` **只能在专用 Preview D1 中运行**。先从 Cloudflare 面板记录 Preview 和生产真实 D1 UUID，并在测试 D1 中插入对应 `environment_identity.database_id` 值。服务端会在允许 Preview GET 之前读取实际绑定数据库里的值，不存在或不一致均返回 503。只填环境变量而未核实数据库标记将无法访问。
- Preview 使用自定义域名时需要 `APP_ENV=preview` 或由平台提供非 main 的 `CF_PAGES_BRANCH`。不能仅依靠域名猜测环境。上线前应在 Cloudflare 平台核验所有绑定、域名和变量。
- 浏览器端新实时秒钟表、日历最大收支标记、自然语言周期文本解析均只影响 UI/待确认草稿，不会运行生产 D1 删除/更新脚本。

### 正式部署前数据库验收

先对独立复制的 D1 检查 `entries` 数量、SBI `current_value` / `pnl`、自定义规则、固定支出和历史账单；分别验证一次性兼容版本标记与新事务化备份恢复。**没有独立 D1 账户授权时，不能宣称生产库已完成物理迁移或 Preview 独立绑定。**

## 2026-10-29: 「その他」を全プルダウンの末尾に固定する

- 支払方法の `payment_sources.sort_order` では `その他` / `其他` が常に `99999`。新しいカード、復元カードはこれより小さい値を取得する。既存カードの相対順序・締め日・利用明細・請求情報は変更しない。
- カテゴリー専用 `category_sort_order` テーブルを追加。支出 `其他` と収入 `其他收入` を `99999`、標準分類を0～8、既存/新規のカスタム分類を `99999` 未満とする。既存 `rules` / `category_icons` テーブルは保護する。
- `migrations/0004_other_last_sort_order.sql` は新しいデータベース複製で事前検証してから適用する再実行可能な SQL。Cloudflare Pages のビルドは本番 D1 にこの SQL を自動実行した証明ではない。
- Webアプリが `payment-sources` / `categories` を取得すると、サーバーは既存 D1 の不足するソートメタデータを補完する。その後 `99999` の実値を D1 で確認できる。実環境の確認なしに物理適用済みとは宣言しない。
- カテゴリー・カード・入金・固定支出などの選択肢はクライアントでも「その他」を末尾に固定し、データ変更ではなく表示順のみに作用する。

## 2026-10-29: 商家規則の統合（PR #110）

- **現行の唯一の書き込み先**：`merchant_rules(keyword PRIMARY KEY, category NULL, payment_source NULL)`。1つのキーワードに分類と支払方法の両方を登録でき、片方の変更/削除はもう一方を保持する。
- 旧 `custom_rules` / `merchant_payment_rules` は本番で存在する場合、`ensureUnifiedMerchantRules` が両者を1つの D1 `batch()` トランザクションでコピーする。両方の値を同一キーワードに合わせ、`schema_migrations.unified-merchant-rules-v1` を最後に記録。コピーが失敗すると標記も書かれず、再試行可能。
- **旧表はDROPもDELETEもしない**。既存 DB に限り、切り戻し/照合のため読み取り専用の履歴表として残す。新規 `schema.sql` からは旧2表を新設しない。すでに使われている表を直接削除しないこと。
- 既存の `/api/rules` / `/api/custom-rules` / `/api/merchant-payment-rules` の応答形、v1/v2/v3 JSON バックアップの2配列フィールドは維持。バックアップは統合表の2列から作成し、復元も統合表へ追加する。
- **旧バージョンへ切り戻す前**は統合表の追加/変更内容をJSONでエクスポートし、旧バージョン側の旧2表へ安全に反映する計画が必要。旧2表は移行時点のスナップショットであり、その後の最新状態を自動的に同期しない。
- 本番 D1 での移行完了を確かめるには読み取り専用で、`schema_migrations` の標記、統合表の重複しない keyword 数、`category IS NOT NULL` 件数と `payment_source IS NOT NULL` 件数を元の旧表と比較する。SBI の評価額・損益、entries 件数と合計も変更前後で照合する。
- Preview の専用 D1 バインディングが未検証なら API は安全のため停止したままにする。バックアップの実際の復元テストは本番ではなく独立 D1 で行う。

## 浏览器端保存范围

- 已保存的账目、分类、商家规则、支付方式、固定支出、账单、SBI 估值等均以 D1 为准；**并非所有数据都只存在 D1**。
- 小票图片：设备 IndexedDB（现有 30 天 TTL，不随 JSON 账本备份）。
- 登录会话：localStorage/sessionStorage；未保存草稿：localStorage（最长约 7 天）；主题/AI OCR 开关/上次外币：localStorage；PWA 静态页面资源：Service Worker 缓存。
- 本次不擅自清除浏览器草稿、登录状态或收据，也不将个人设备会话口令与图片上传到 D1。

## 2026-10-29: category_source へ統合・旧4表の廃止

- 現行の読み書きは **`category_source(category PRIMARY KEY, sort_order, icon)`** と `merchant_rules(keyword PRIMARY KEY, category, payment_source)` の2表だけを使用する。
- `ensureCategorySource(db)` は初めて該当APIを利用したとき、`category_sort_order` と `category_icons` が存在すれば **両列を1つの `db.batch()` トランザクションでコピー**する。既に入力済みの値を上書きせず、`其他` / `其他收入` の並び順は99999に補正する。移行済みマーカーは `schema_migrations.category-source-v1`。
- `category-icons` API のURLとJSON応答形は旧バージョンとの互換のため残るが、**旧 `category_icons` テーブルへアクセスすることを意味しない**。バックアップ/復元も `category_source` を参照する。
- `custom_rules` / `merchant_payment_rules` は前段の `unified-merchant-rules-v1` で `merchant_rules` に統合済み。現行APIは旧2表を日常使用しない。旧表へのコピーは履歴からの初回移行に限定する。
- **旧4表は自動削除しない**。本番でマーカー、データ件数、既存ルール、カテゴリーの順番/アイコン、entries、SBI評価額を読み取り専用で照合し、完全なバックアップを安全な場所へ保存してから、`migrations/0005_cleanup_legacy_rule_and_category_tables.sql` を**人の承認を得て手動実行**する。安全チェックに失敗したら削除せず理由を解消する。
- 完全削除後に以前のアプリへロールバックすると旧表へのアクセスが失敗する。必要なら `merchant_rules` / `category_source` から復旧用の旧表を再構築できるよう、削除前のバックアップを確保する。
- `migrations/0004_other_last_sort_order.sql` は旧スキーマ用の履歴資料で、現行運用では**再実行しない**。新規 `schema.sql` も旧4表を新設しない。
- テストは独立したインメモリSQLiteで旧表を作成して移行・削除後の動作を検証する。本番 D1 で実行した実績を示すものではない。

## 2026-10-29: D1 を分類表示の唯一の設定元にする

- `category_source` に `display_name` (日本語画面表示名) を追加。既存データベースでは `PRAGMA table_info` により列を確認し、欠落時のみ `ALTER TABLE ... ADD COLUMN`。既存の `icon` 値・`sort_order`・明細の `category` は変更しない。
- 既定カテゴリの日本語名と選択済みアイコンIDは `category-presentation-v1` の一度だけのD1トランザクションで補充する。既存の名称とアイコンは `COALESCE` で保護する。
- `GET /api/category-source` が `category,sort_order,icon,display_name` を返す。Webアプリはこれを読み、日本語表示名とカテゴリ用SVGを決定する。`category-ui.js` に埋め込まれていたカテゴリ別の表示名/デフォルトアイコン対応表は削除。
- `src/icon-library.js` は SVG path を描く静的なアイコン**部品集**。`src/category-sort.js` は支払方法を含む「その他を最後」にするUI用の純粋関数。両者はカテゴリデータの保存先ではないためD1とは役割が異なる。
- 古いv3 JSONバックアップは引き続き `categories` と `categoryIcons` を含み、旧版に存在しない `display_name` は新規DBの標準値で復元される。カスタム分類はユーザーが登録した名称をそのまま表示する。
- 本番 D1 での結果はAPI初回呼出後に `schema_migrations.category-presentation-v1` を読み取り専用で確認し、各 `category_source` レコードの `display_name` と `icon` を確認する。Cloudflare Pages のビルド成功だけでは本番物理更新が完了した証拠にならない。


## SBI証券：D1 0006 追加表・一度きりの初期データ（手動移行）

`migrations/0006_sbi_portfolio_linkage.sql` は既存取引や旧手入力評価額を削除・上書きせず、次の5表を追加し、ユーザーが提示した2026/10/30の四銘柄を **INSERT OR IGNORE / NOT EXISTS で1度だけ初期化**する。

- `investment_plans`：現在の4銘柄積立設定（オルカン7000 / S&P500 3000 / 先進国債券3000 / NASDAQ100 2000、9日）。
- `investment_plan_history`：2026-10の初期配分と、以後の適用開始月ごとの変更。移行を再実行しても後から追加された5本目や値上げ分が過去月に流入しない。
- `investment_holdings`：SBIの2026/10/30 00:41画面に表示された実際の持分、取得金額、当時の評価額（4銘柄合計 ¥71,560、取得総額 ¥71,439）。3銘柄は成長＋つみたての**合算表示**なので、分けた口数を勝手に作らず `combined` を使う。
- `fund_prices`：上記スクリーンショットで観察した基準価額。「2026-10-30」は**画面確認日**であり、正式な基準価額算定日ではない。正式な基準価額をユーザー入力した時点で自動計算に切替える。外部NAV自動更新はまだ未実装。
- `sbi_transfer_links`：既存 `entries` のSBI振替IDと買付月の修正対応。設定のない行は振替日からの**推定**月で表示し、確定した約定と解釈しない。

### 導入順と確認条件

1. 本番D1をバックアップし、既存 `entries` の件数・振替合計、`investment_snapshots` の評価額・損益の値を保存する。
2. **隔離したコピーD1**に以下と同じSQLを適用し、数量4・定投額15000・評価額71560・旧データ不変・再実行で重複なし・v4バックアップからの復元を照合する。
3. 同じSQLを本番D1に**明示的に**適用する（画面GET/アプリ起動時にスキーマを新設しない）。通常の `wrangler` 設定を使う場合のコマンド例：
   
   ```bash
   npx wrangler d1 execute kakeibo --remote --file=./migrations/0006_sbi_portfolio_linkage.sql
   ```
   
   実行前に対象D1の名前・IDと本番環境を確認し、プレビューDBと取り違えないこと。
4. 旧評価額と古い資産移動明細が残っていることを読み取り専用で再照合し、アプリのPRをマージしてCloudflare Pagesに配置する。移行済みDBでは初回の「登録」ボタンは不要で、四銘柄が自動表示される。
5. ¥15,000の資産移動と配分¥7,000+¥3,000+¥3,000+¥2,000の月次照合が見えること、未来日・二度処理が二重に資産計上されないことを確認する。

**本番D1の移行は未実施。** GitHubコミット・ローカルSQLite検証はCloudflare D1の本番書き込みやCI成功を証明しない。移行前にアプリを表示した場合、投資用APIは503になり、旧 `investment_snapshots` は別の表示領域に残る。Actionsは現在workflow_dispatchのみで、勝手な無料枠消費はしない。

撤回が必要なら旧 `investment_snapshots` と `entries` はそのまま保持されているため、表示を切り戻せる。新規投資表を削除するのは別途バックアップと明示承認がある場合だけ。


## 2026-10-30: 0007 — 交通系ICプリペイド（Suica / PASMO）

- 現行 `payment_sources` に `source_type`, `opening_balance`, `opening_date`, `opening_entry_id` の **4列だけ追加**する。新しいデータ表の作成、既存行の更新、種別の自動判定・変更は行わない。
- `entries.transfer_target='prepaid:Suica'` 等をプリペイドへのチャージ先に使用し、チャージは `transfer`（生活費の支出合計に含めない）、実利用は `expense`（支出に含める）。残高は期首残高＋期首以降のチャージ－期首以降の支出から取得し、別に残高数値を保存しない。
- 既にある取引の種別や支払先は **自動変更しない**。ユーザーがカードをプリペイドに切り替えた時点を起点にし、実残高を「資産」画面で入力する。古い明細を巻き戻して再集計しない。
- 本番 D1 に 0007 を**一度だけ**明示適用する。既存 `payment_sources` の列を `PRAGMA table_info(payment_sources)` で事前確認し、すでに適用済みなら再実行しない。適用は確認後、次のコマンド（`wrangler.toml` が本番DBを指すことを確認）:
  ```bash
  npx wrangler d1 execute kakeibo --remote --file=./migrations/0007_prepaid_card_assets.sql
  ```
- `investment_snapshots` は新規DBの `schema.sql` で作成せず、実行時の API・自動取得・バックアップ・復元から完全に切り離した。旧エンドポイント `/api/investments` は 410。古い v1–v3 バックアップの `investments` データは検証可能だが、書き戻しはしない。**本番の旧テーブルとデータは削除しない**。
- `migrations/0006_sbi_portfolio_linkage.sql` に関する上記の「移行未実施」「旧画面に表示」「自動NAV未実装」の記述は当時の履歴であり、2026-10-30の現行構成・進捗の説明ではない。SBI保有管理・NAVの更新用Workerは独立して維持する。

## 2026-11-01: 0012 — 共通の復元可能なゴミ箱（手動移行）

**PR #193 は本番D1の移行0012を確認するまでマージ禁止。**

- `trash_items(item_type,item_id,payload_json,deleted_at)` は削除した固定費と明細の復元情報を保存する。月別除外と通知確認は独立のまま。
- 固定費の実体は `recurring_plans` に残す。明細はD1トランザクション内でID、内容、SBIリンク、確認状態を保存してから削除し、元のIDで復元する。
- レシート画像は元の端末に残るが、現行の保管期間（最大30日）は変わらない。JSONバックアップに画像ファイルは含まれない。
- 既存の `recurring_plan_trash` は0012で読み取り・コピーするだけ。**旧表をDROPしない。** アプリ起動やCIでの自動移行・旧データ再投入は禁止。

### 安全な本番適用順

1. 本番D1を完全バックアップし、テスト用D1で復元を確認。移行前の明細件数、SBI保有、固定費件数を控える。
2. `SELECT COUNT(*) FROM recurring_plan_trash;`、`SELECT COUNT(*) FROM recurring_plans;`、`SELECT COUNT(*) FROM entries;` で件数を確認する。
3. 独立したテスト用D1で移行0012を実行し、明細削除・復元、SBIリンク復元、固定費削除・復元、バックアップ復元のテストを実施。
4. PR #193のPagesとWorkersビルド、全テストが合格したら、**マージ前に**本番で次のSQLを一度だけ明示適用する（旧版は旧表を引き続き参照するため利用可能）。

   npx wrangler d1 execute kakeibo --remote --file=./migrations/0012_unified_trash_items.sql

5. `SELECT item_type, COUNT(*) AS n FROM trash_items GROUP BY item_type;` で旧アーカイブ件数と新しいrecurring_plan件数を比較。明細件数とSBI保有が不変であることを確認してからPRをマージ。
6. 新版の本番動作とバックアップ、ロールバック手順が確認できるまで旧 `recurring_plan_trash` は保留。後日削除する場合も**別途明示的な手動操作**とし、自動DROPは行わない。

マイグレーション0012を適用する前にPRをマージすると、`trash_items` が存在せず削除機能が失敗するため順番を守る。
