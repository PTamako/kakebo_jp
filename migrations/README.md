# D1 マイグレーション運用

本番 D1 に接続している API は現在、旧インストールの列不足を検出して互換的に追加します。安全な移行手順が検証されるまで**この処理を一度に削除しない**でください。

1. 本番のテーブル構成、件数、SBI の current_value / pnl、分類規則を読み取り専用で記録する。
2. 本番とは別の D1 複製を用意し、まず `migrations/0001_support_tables.sql` を複製で試す。
3. 対象 DB に `entries.type` / `payment_source` / `client_request_id` / `transfer_*` があるかを検査する。旧 DB には列が存在しない場合があるため、新規 schema.sql を既存 DB の全面移行と誤用しない。
4. 旧バックアップ v1 / v2 / v3 を複製に復元し、件数、SBI、ユーザー規則、固定支出を検証する。
5. 本番適用には別途承認が必要。現段階では旧 API の互換マイグレーションは維持する。

この PR では既存 D1 に SQL を実行していない。ファイルは段階的な移行の準備であり、本番移行完了の証明ではない。

## 新规则切换（2026-10-29）
- 旧内置 rules 行暂时保留在 D1 作为历史迁移资料，但 **不再参与自动分类**。API 返回由当前 `DEFAULT_RULE_ROWS` 和 `custom_rules` 合成，后者优先。
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
